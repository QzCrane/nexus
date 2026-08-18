// goal: bind each staged release ZIP to the exact dependency/license graph and build identity
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
const defaultSbomPath = resolve(repositoryRoot, 'artifacts/supply-chain/nexus.cdx.json');

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
	return { schemaVersion: 1, packages };
}

function writeCanonicalJson(path: string, value: unknown): string {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	writeFileSync(path, content, 'utf8');
	return sha256Buffer(content);
}

export function generateReleaseSupplyChainEvidence({
	product,
	artifactPath,
	sbomPath = defaultSbomPath,
	recordedAt = new Date().toISOString(),
	identity,
}: {
	product: 'halo' | 'spectra';
	artifactPath: string;
	sbomPath?: string;
	recordedAt?: string;
	identity?: { head: string; tree: string };
}) {
	const artifact = resolve(artifactPath);
	if (!existsSync(artifact)) throw new Error(`release artifact is missing: ${artifact}`);
	if (!existsSync(sbomPath)) generateSbom(sbomPath);
	const sbom = JSON.parse(readFileSync(sbomPath, 'utf8')) as CycloneDxDocument;
	const inventory = buildLicenseInventory(sbom);
	const licensePath = `${artifact}.licenses.json`;
	const provenancePath = `${artifact}.provenance.json`;
	mkdirSync(dirname(licensePath), { recursive: true });
	const licensesSha256 = writeCanonicalJson(licensePath, inventory);
	const gitIdentity = identity ?? {
		head: git(['rev-parse', 'HEAD']),
		tree: git(['rev-parse', 'HEAD^{tree}']),
	};
	const provenance = {
		schemaVersion: 1,
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
		},
		licenses: {
			path: relative(repositoryRoot, licensePath).replaceAll('\\', '/'),
			sha256: licensesSha256,
			packages: inventory.packages.length,
			unknown: inventory.packages.filter((entry) => entry.license === 'UNKNOWN').length,
		},
		inputs: {
			workspaceLockSha256: sha256File(resolve(workspaceDir, 'bun.lock')),
			repositoryLockSha256: sha256File(resolve(repositoryRoot, 'bun.lock')),
			browserFloorSha256: sha256File(resolve(workspaceDir, 'browser-floor.json')),
			closeoutPolicySha256: sha256File(resolve(workspaceDir, 'closeout-policy.json')),
		},
	};
	const provenanceSha256 = writeCanonicalJson(provenancePath, provenance);
	console.log(`✓ Release supply-chain evidence: ${relative(repositoryRoot, provenancePath).replaceAll('\\', '/')} (${provenanceSha256})`);
	return { licensePath, provenancePath, licensesSha256, provenanceSha256, provenance };
}
