// goal: bind each final release ZIP to the exact dependency/license graph and build identity
// inv: sidecars are deterministic for identical artifact/source/tool inputs and never enter the extension ZIP

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSbom } from './generate-sbom.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const supplyChainDir = resolve(repositoryRoot, 'artifacts/supply-chain');
const defaultSbomPath = resolve(supplyChainDir, 'nexus.cdx.json');

interface CycloneDxComponent {
	'bom-ref'?: unknown;
	name?: unknown;
	version?: unknown;
	licenses?: unknown;
	properties?: unknown;
}

interface CycloneDxDocument {
	components?: unknown;
}

interface RetainedDependencyPackage {
	name?: unknown;
	version?: unknown;
	license?: unknown;
	bytesInOutput?: unknown;
	inputs?: unknown;
}

interface RetainedDependencyEvidence {
	schemaVersion?: unknown;
	product?: unknown;
	scope?: unknown;
	npmArtifactScoped?: unknown;
	wholeArtifactScoped?: unknown;
	analysisSha256?: unknown;
	packages?: unknown;
}

function sha256Buffer(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
	return sha256Buffer(readFileSync(path));
}

function git(args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`);
	const output = String(result.stdout ?? '').trim();
	if (!/^[a-f0-9]{40}$/u.test(output)) throw new Error(`git ${args.join(' ')} did not return an exact SHA`);
	return output;
}

function licenseExpression(component: CycloneDxComponent): string {
	if (!Array.isArray(component.licenses)) return 'UNKNOWN';
	const expressions = component.licenses.flatMap((entry) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
		const expression = (entry as { expression?: unknown }).expression;
		return typeof expression === 'string' && expression.trim() ? [expression.trim()] : [];
	});
	return expressions.length > 0 ? [...new Set(expressions)].sort().join(' OR ') : 'UNKNOWN';
}

function dependencyKind(component: CycloneDxComponent): string | null {
	if (!Array.isArray(component.properties)) return null;
	for (const entry of component.properties) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const property = entry as { name?: unknown; value?: unknown };
		if (property.name === 'nexus:dependency-kind' && typeof property.value === 'string') return property.value;
	}
	return null;
}

function packageKey(name: string, version: string): string {
	return `${name}\0${version}`;
}

export function buildLicenseInventory(sbom: CycloneDxDocument) {
	if (!Array.isArray(sbom.components)) throw new Error('CycloneDX SBOM has no components array');
	const packages = (sbom.components as CycloneDxComponent[]).flatMap((component) => {
		if (dependencyKind(component) !== 'external') return [];
		if (typeof component.name !== 'string' || typeof component.version !== 'string') {
			throw new Error('CycloneDX external component is missing name/version');
		}
		return [{
			name: component.name,
			version: component.version,
			license: licenseExpression(component),
			bomRef: typeof component['bom-ref'] === 'string' ? component['bom-ref'] : null,
		}];
	}).sort((left, right) => (
		left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
	));
	return {
		schemaVersion: 2,
		scope: 'workspace-installed-graph' as const,
		artifactScoped: false as const,
		packages,
	};
}

function validateRetainedEvidence(
	product: 'halo' | 'spectra',
	value: RetainedDependencyEvidence,
): asserts value is RetainedDependencyEvidence & { packages: RetainedDependencyPackage[] } {
	if (value.schemaVersion !== 1
		|| value.product !== product
		|| value.scope !== 'product-retained-npm-runtime'
		|| value.npmArtifactScoped !== true
		|| value.wholeArtifactScoped !== false
		|| typeof value.analysisSha256 !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(value.analysisSha256)
		|| !Array.isArray(value.packages)) {
		throw new Error(`${product}: retained dependency evidence is malformed`);
	}
}

export function buildProductLicenseInventory(
	product: 'halo' | 'spectra',
	sbom: CycloneDxDocument,
	retained: RetainedDependencyEvidence,
) {
	validateRetainedEvidence(product, retained);
	const workspaceInventory = buildLicenseInventory(sbom);
	const components = new Map<string, (typeof workspaceInventory.packages)[number]>();
	for (const component of workspaceInventory.packages) {
		const key = packageKey(component.name, component.version);
		if (components.has(key)) throw new Error(`CycloneDX contains duplicate external component ${component.name}@${component.version}`);
		components.set(key, component);
	}

	const seen = new Set<string>();
	const packages = retained.packages.map((entry) => {
		if (typeof entry.name !== 'string' || !entry.name
			|| typeof entry.version !== 'string' || !entry.version
			|| typeof entry.bytesInOutput !== 'number'
			|| !Number.isFinite(entry.bytesInOutput) || entry.bytesInOutput <= 0
			|| !Array.isArray(entry.inputs) || entry.inputs.length === 0
			|| entry.inputs.some((input) => typeof input !== 'string' || !input)) {
			throw new Error(`${product}: retained dependency package metadata is malformed`);
		}
		const key = packageKey(entry.name, entry.version);
		if (seen.has(key)) throw new Error(`${product}: retained dependency repeats ${entry.name}@${entry.version}`);
		seen.add(key);
		const component = components.get(key);
		if (!component) {
			throw new Error(`${product}: retained package ${entry.name}@${entry.version} is absent from the exact installed SBOM`);
		}
		const observedLicense = typeof entry.license === 'string' && entry.license.trim()
			? entry.license.trim()
			: null;
		if (observedLicense && component.license !== 'UNKNOWN' && observedLicense !== component.license) {
			throw new Error(
				`${product}: retained package license drift for ${entry.name}@${entry.version}: build=${observedLicense}, sbom=${component.license}`,
			);
		}
		return {
			name: entry.name,
			version: entry.version,
			license: component.license,
			bomRef: component.bomRef,
			bytesInOutput: entry.bytesInOutput,
		};
	}).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

	return {
		schemaVersion: 3,
		scope: 'product-retained-npm-runtime' as const,
		npmArtifactScoped: true as const,
		wholeArtifactScoped: false as const,
		packages,
	};
}

function writeCanonicalJson(path: string, value: unknown): string {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	writeFileSync(path, content, 'utf8');
	return sha256Buffer(content);
}

export function finalArtifactPath(product: 'halo' | 'spectra'): string {
	const extensionDir = resolve(workspaceDir, `apps/extension-${product}`);
	const pkg = JSON.parse(readFileSync(resolve(extensionDir, 'package.json'), 'utf8')) as { version?: unknown };
	if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pkg.version)) {
		throw new Error(`${product}: package version is not SemVer`);
	}
	return product === 'halo'
		? resolve(extensionDir, `release/.staging/halo-v${pkg.version}.zip`)
		: resolve(extensionDir, `release/spectra-v${pkg.version}.zip`);
}

function hashedInput(path: string): { path: string; sha256: string } {
	if (!existsSync(path)) throw new Error(`supply-chain input is missing: ${path}`);
	return {
		path: relative(repositoryRoot, path).replaceAll('\\', '/'),
		sha256: sha256File(path),
	};
}

function productInputs(product: 'halo' | 'spectra') {
	const extensionDir = resolve(workspaceDir, `apps/extension-${product}`);
	const productPaths = product === 'halo'
		? [
			'package.json',
			'build.ts',
			'public/manifest.json',
			'release-admission.json',
			'release-test-owners.json',
		]
		: [
			'package.json',
			'build.ts',
			'public/manifest.json',
			'permission-policy.json',
		];
	return productPaths.map((path) => hashedInput(resolve(extensionDir, path)));
}

function governanceInputs() {
	return [
		'browser-floor.json',
		'closeout-policy.json',
		'dependency-domains.json',
		'dependency-revalidation.json',
		'direct-dependency-policy.json',
		'feature-promotion.json',
		'runtime-performance-policy.json',
		'typescript-7-epoch.json',
		'visual-regression-policy.json',
	].map((path) => hashedInput(resolve(workspaceDir, path)));
}

function retainedEvidencePath(product: 'halo' | 'spectra'): string {
	return resolve(supplyChainDir, `${product}.retained-dependencies.json`);
}

export function generateReleaseSupplyChainEvidence({
	product,
	artifactPath,
	sbomPath = defaultSbomPath,
	retainedPath = retainedEvidencePath(product),
	recordedAt = new Date().toISOString(),
	identity,
}: {
	product: 'halo' | 'spectra';
	artifactPath: string;
	sbomPath?: string;
	retainedPath?: string;
	recordedAt?: string;
	identity?: { head: string; tree: string };
}) {
	const artifact = resolve(artifactPath);
	if (!existsSync(artifact)) throw new Error(`release artifact is missing: ${artifact}`);
	if (!existsSync(sbomPath)) generateSbom(sbomPath);
	if (!existsSync(retainedPath)) {
		throw new Error(`${product}: retained runtime dependency evidence is missing; rebuild the exact production candidate`);
	}
	const sbom = JSON.parse(readFileSync(sbomPath, 'utf8')) as CycloneDxDocument;
	const retained = JSON.parse(readFileSync(retainedPath, 'utf8')) as RetainedDependencyEvidence;
	const inventory = buildProductLicenseInventory(product, sbom, retained);
	const licensePath = `${artifact}.licenses.json`;
	const provenancePath = `${artifact}.provenance.json`;
	mkdirSync(dirname(licensePath), { recursive: true });
	const licensesSha256 = writeCanonicalJson(licensePath, inventory);
	const gitIdentity = identity ?? {
		head: git(['rev-parse', 'HEAD']),
		tree: git(['rev-parse', 'HEAD^{tree}']),
	};
	const provenance = {
		schemaVersion: 3,
		recordedAt,
		product,
		head: gitIdentity.head,
		tree: gitIdentity.tree,
		builder: {
			bun: Bun.version,
			platform: process.platform,
			arch: process.arch,
		},
		artifact: {
			path: relative(repositoryRoot, artifact).replaceAll('\\', '/'),
			sha256: sha256File(artifact),
			bytes: readFileSync(artifact).byteLength,
		},
		sbom: {
			path: relative(repositoryRoot, sbomPath).replaceAll('\\', '/'),
			sha256: sha256File(sbomPath),
			scope: 'workspace-installed-graph',
			artifactScoped: false,
		},
		retainedDependencies: {
			...hashedInput(retainedPath),
			scope: inventory.scope,
			npmArtifactScoped: inventory.npmArtifactScoped,
			wholeArtifactScoped: inventory.wholeArtifactScoped,
			packages: inventory.packages.length,
		},
		licenses: {
			path: relative(repositoryRoot, licensePath).replaceAll('\\', '/'),
			sha256: licensesSha256,
			scope: inventory.scope,
			npmArtifactScoped: inventory.npmArtifactScoped,
			wholeArtifactScoped: inventory.wholeArtifactScoped,
			packages: inventory.packages.length,
			unknown: inventory.packages.filter((entry) => entry.license === 'UNKNOWN').length,
		},
		inputs: {
			workspaceLock: hashedInput(resolve(workspaceDir, 'bun.lock')),
			repositoryLock: hashedInput(resolve(repositoryRoot, 'bun.lock')),
			product: productInputs(product),
			governance: governanceInputs(),
		},
	};
	const provenanceSha256 = writeCanonicalJson(provenancePath, provenance);
	console.log(`✓ Release supply-chain evidence: ${relative(repositoryRoot, provenancePath).replaceAll('\\', '/')} (${provenanceSha256})`);
	return { licensePath, provenancePath, licensesSha256, provenanceSha256, provenance };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const product = process.argv[2];
	if (product !== 'halo' && product !== 'spectra') {
		throw new Error('usage: bun scripts/release-supply-chain.ts <halo|spectra>');
	}
	generateReleaseSupplyChainEvidence({ product, artifactPath: finalArtifactPath(product) });
}
