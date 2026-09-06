// goal: Emit a deterministic CycloneDX inventory from the exact installed Nexus dependency graph.
// inv: no network calls, no timestamps, stable ordering, and the workspace lockfile digest is embedded.

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageDocument {
	name?: string;
	version?: string;
	private?: boolean;
	license?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface InstalledPackage {
	name: string;
	version: string;
	packageDir: string;
	document: PackageDocument;
	bomRef: string;
}

interface CycloneDxComponent {
	type: 'application' | 'library';
	'bom-ref': string;
	name: string;
	version: string;
	purl: string;
	licenses?: Array<{ expression: string }>;
	properties?: Array<{ name: string; value: string }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = dirname(scriptDir);
const repositoryRoot = dirname(workspaceDir);
const defaultOutput = resolve(repositoryRoot, 'artifacts/supply-chain/nexus.cdx.json');

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function packagePurl(name: string, version: string): string {
	const encodedName = name.startsWith('@')
		? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
		: encodeURIComponent(name);
	return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function packageDependencyNames(document: PackageDocument): string[] {
	return [...new Set([
		...Object.keys(document.dependencies ?? {}),
		...Object.keys(document.devDependencies ?? {}),
		...Object.keys(document.optionalDependencies ?? {}),
		...Object.keys(document.peerDependencies ?? {}),
	])].sort();
}

function packageDirectories(nodeModulesDir: string): string[] {
	if (!existsSync(nodeModulesDir)) return [];
	const directories: string[] = [];
	for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const candidate = join(nodeModulesDir, entry.name);
		if (entry.name.startsWith('@')) {
			if (!entry.isDirectory()) continue;
			for (const scoped of readdirSync(candidate, { withFileTypes: true })) {
				if (scoped.isDirectory() || scoped.isSymbolicLink()) directories.push(join(candidate, scoped.name));
			}
			continue;
		}
		if (entry.isDirectory() || entry.isSymbolicLink()) directories.push(candidate);
	}
	return directories.sort();
}

export function collectInstalledPackages(nodeModulesDir: string): InstalledPackage[] {
	const queue = packageDirectories(nodeModulesDir);
	const seenPhysicalDirectories = new Set<string>();
	const packages = new Map<string, InstalledPackage>();

	while (queue.length > 0) {
		const packageDir = queue.shift();
		if (!packageDir) continue;
		let physicalDirectory: string;
		try {
			physicalDirectory = realpathSync(packageDir);
		} catch {
			continue;
		}
		if (seenPhysicalDirectories.has(physicalDirectory)) continue;
		seenPhysicalDirectories.add(physicalDirectory);
		const packageJsonPath = join(packageDir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const document = readJson<PackageDocument>(packageJsonPath);
		if (typeof document.name !== 'string' || typeof document.version !== 'string') continue;
		const bomRef = packagePurl(document.name, document.version);
		packages.set(bomRef, {
			name: document.name,
			version: document.version,
			packageDir,
			document,
			bomRef,
		});
		queue.push(...packageDirectories(join(packageDir, 'node_modules')));
	}

	return [...packages.values()].sort((left, right) => left.bomRef.localeCompare(right.bomRef));
}

function workspacePackageDirectories(root: string): string[] {
	const directories: string[] = [root];
	for (const collection of ['apps', 'packages']) {
		const collectionPath = join(root, collection);
		if (!existsSync(collectionPath)) continue;
		for (const entry of readdirSync(collectionPath, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const candidate = join(collectionPath, entry.name);
			if (existsSync(join(candidate, 'package.json'))) directories.push(candidate);
			if (collection === 'packages' && entry.name === 'features') {
				for (const feature of readdirSync(candidate, { withFileTypes: true })) {
					const featurePath = join(candidate, feature.name);
					if (feature.isDirectory() && existsSync(join(featurePath, 'package.json'))) directories.push(featurePath);
				}
			}
		}
	}
	return directories.sort();
}

function collectWorkspacePackages(root: string): InstalledPackage[] {
	return workspacePackageDirectories(root).flatMap((packageDir) => {
		const document = readJson<PackageDocument>(join(packageDir, 'package.json'));
		if (typeof document.name !== 'string' || typeof document.version !== 'string') return [];
		return [{
			name: document.name,
			version: document.version,
			packageDir,
			document,
			bomRef: packagePurl(document.name, document.version),
		}];
	}).sort((left, right) => left.bomRef.localeCompare(right.bomRef));
}

function resolveDependencyPackageJson(
	fromDirectory: string,
	dependencyName: string,
	workspaceRoot: string,
): string | null {
	let current = resolve(fromDirectory);
	const boundary = resolve(workspaceRoot, '..');
	while (true) {
		const escapedBoundary = relative(boundary, current);
		if (escapedBoundary.startsWith('..')) break;
		const candidate = join(current, 'node_modules', dependencyName, 'package.json');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

function componentFor(
	pkg: InstalledPackage,
	internal: boolean,
	rootPackageDirectory: string,
): CycloneDxComponent {
	const component: CycloneDxComponent = {
		type: resolve(pkg.packageDir) === resolve(rootPackageDirectory) ? 'application' : 'library',
		'bom-ref': pkg.bomRef,
		name: pkg.name,
		version: pkg.version,
		purl: pkg.bomRef,
	};
	if (typeof pkg.document.license === 'string' && pkg.document.license.trim()) {
		component.licenses = [{ expression: pkg.document.license.trim() }];
	}
	component.properties = [{
		name: 'nexus:dependency-kind',
		value: internal ? 'workspace' : 'external',
	}];
	return component;
}

export function buildCycloneDxBom({
	workspaceRoot = workspaceDir,
	nodeModulesDir = resolve(workspaceRoot, 'node_modules'),
	lockfilePath = resolve(workspaceRoot, 'bun.lock'),
	bunVersion = Bun.version,
}: {
	workspaceRoot?: string;
	nodeModulesDir?: string;
	lockfilePath?: string;
	bunVersion?: string;
} = {}) {
	if (!existsSync(nodeModulesDir)) {
		throw new Error(`SBOM requires an installed dependency graph: ${nodeModulesDir}`);
	}
	if (!existsSync(lockfilePath)) throw new Error(`SBOM lockfile is missing: ${lockfilePath}`);

	const workspacePackages = collectWorkspacePackages(workspaceRoot);
	const installedPackages = collectInstalledPackages(nodeModulesDir);
	const allPackages = new Map<string, InstalledPackage>();
	for (const pkg of [...workspacePackages, ...installedPackages]) allPackages.set(pkg.bomRef, pkg);
	const workspaceRefs = new Set(workspacePackages.map((pkg) => pkg.bomRef));
	const components = [...allPackages.values()]
		.map((pkg) => componentFor(pkg, workspaceRefs.has(pkg.bomRef), workspaceRoot))
		.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));

	const dependencies = [...allPackages.values()].map((pkg) => {
		const dependsOn = new Set<string>();
		for (const dependencyName of packageDependencyNames(pkg.document)) {
			const packageJsonPath = resolveDependencyPackageJson(pkg.packageDir, dependencyName, workspaceRoot);
			if (!packageJsonPath) continue;
			const dependency = readJson<PackageDocument>(packageJsonPath);
			if (typeof dependency.name !== 'string' || typeof dependency.version !== 'string') continue;
			const ref = packagePurl(dependency.name, dependency.version);
			if (allPackages.has(ref) && ref !== pkg.bomRef) dependsOn.add(ref);
		}
		return { ref: pkg.bomRef, dependsOn: [...dependsOn].sort() };
	}).sort((left, right) => left.ref.localeCompare(right.ref));

	const rootPackage = workspacePackages.find((pkg) => resolve(pkg.packageDir) === resolve(workspaceRoot));
	if (!rootPackage) throw new Error('SBOM workspace root package metadata is missing');
	return {
		bomFormat: 'CycloneDX',
		specVersion: '1.6',
		version: 1,
		metadata: {
			component: componentFor(rootPackage, true, workspaceRoot),
			properties: [
				{ name: 'nexus:bun-version', value: bunVersion },
				{ name: 'nexus:lockfile-sha256', value: sha256File(lockfilePath) },
			],
		},
		components,
		dependencies,
	};
}

export function serializeCycloneDxBom(bom: ReturnType<typeof buildCycloneDxBom>): string {
	return `${JSON.stringify(bom, null, 2)}\n`;
}

export function generateSbom(outputPath = defaultOutput): string {
	const content = serializeCycloneDxBom(buildCycloneDxBom());
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, content);
	const digest = createHash('sha256').update(content).digest('hex');
	console.log(`✓ SBOM ${relative(repositoryRoot, outputPath).replaceAll('\\', '/')} (${digest})`);
	return digest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length > 2 || (args[0] !== undefined && args[0] !== '--out')) {
		throw new Error('usage: bun scripts/generate-sbom.ts [--out <path>]');
	}
	generateSbom(args[0] === '--out' && args[1] ? resolve(args[1]) : defaultOutput);
}
