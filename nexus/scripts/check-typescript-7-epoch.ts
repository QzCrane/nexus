// goal: make the TypeScript 5.9 -> 6 API -> 7 native migration an explicit, fail-closed epoch
// inv: compiler/API generations cannot be partially changed without advancing the epoch and satisfying its package/config owners

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const epochPath = resolve(workspaceDir, 'typescript-7-epoch.json');
const lockPath = resolve(workspaceDir, 'bun.lock');
const revalidationPath = resolve(workspaceDir, 'dependency-revalidation.json');
const syncPublicPath = resolve(workspaceDir, 'scripts/sync-public.ts');
const SKIP_DIRECTORIES = new Set(['.git', '.turbo', 'dist', 'node_modules', 'release', 'test-results']);
const PHASES = ['compatibility-prep', 'ts6-api-clean', 'dual-cli', 'native-default', 'api-convergence'] as const;
const KNOWN_DEPRECATED_CONFIG = [
	'baseUrl',
	'downlevelIteration',
	'moduleResolution=node',
	'moduleResolution=node10',
	'moduleResolution=classic',
	'target=es5',
	'module=amd',
	'module=umd',
	'module=system',
	'outFile',
	'esModuleInterop=false',
	'allowSyntheticDefaultImports=false',
	'alwaysStrict=false',
	'ignoreDeprecations',
] as const;

type EpochPhase = typeof PHASES[number];

interface EpochPackagePlan {
	package: string;
	version: string;
	plannedAlias: string;
	plannedPackagePaths?: string[];
	plannedPackagePath?: string;
	reason: string;
}

interface ApiConsumer {
	path: string;
	packagePath: string;
	marker: string;
	role: string;
	publicProjection: boolean;
}

interface TypeScriptEpoch {
	schemaVersion: 1;
	phase: EpochPhase;
	currentLockedVersion: string;
	compatibilityApi: EpochPackagePlan;
	nativeCli: EpochPackagePlan;
	programmaticApiConsumers: ApiConsumer[];
	ts6DeprecatedConfig: string[];
	stages: Array<{ id: EpochPhase; requires: string[] }>;
}

interface PackageDocument {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface DependencyRevalidation {
	entries?: Array<{ dependency?: string; lockedVersion?: string; observedLatest?: string; lane?: string }>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function canonical(values: readonly string[]): string {
	return [...values].sort().join('\0');
}

function dependencyValue(document: PackageDocument, dependency: string): string | undefined {
	return document.dependencies?.[dependency]
		?? document.devDependencies?.[dependency]
		?? document.peerDependencies?.[dependency];
}

function collectTsConfigPaths(directory = workspaceDir): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			paths.push(...collectTsConfigPaths(path));
			continue;
		}
		if (entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/u.test(entry.name)) paths.push(path);
	}
	return paths.sort();
}

export function deprecatedCompilerOptions(compilerOptions: Record<string, unknown>): string[] {
	const issues: string[] = [];
	if (Object.hasOwn(compilerOptions, 'baseUrl')) issues.push('baseUrl');
	if (Object.hasOwn(compilerOptions, 'downlevelIteration')) issues.push('downlevelIteration');
	const moduleResolution = typeof compilerOptions.moduleResolution === 'string'
		? compilerOptions.moduleResolution.toLowerCase()
		: '';
	if (moduleResolution === 'node') issues.push('moduleResolution=node');
	if (moduleResolution === 'node10') issues.push('moduleResolution=node10');
	if (moduleResolution === 'classic') issues.push('moduleResolution=classic');
	const target = typeof compilerOptions.target === 'string' ? compilerOptions.target.toLowerCase() : '';
	if (target === 'es5') issues.push('target=es5');
	const moduleKind = typeof compilerOptions.module === 'string' ? compilerOptions.module.toLowerCase() : '';
	if (moduleKind === 'amd') issues.push('module=amd');
	if (moduleKind === 'umd') issues.push('module=umd');
	if (moduleKind === 'system' || moduleKind === 'systemjs') issues.push('module=system');
	if (Object.hasOwn(compilerOptions, 'outFile')) issues.push('outFile');
	if (compilerOptions.esModuleInterop === false) issues.push('esModuleInterop=false');
	if (compilerOptions.allowSyntheticDefaultImports === false) issues.push('allowSyntheticDefaultImports=false');
	if (compilerOptions.alwaysStrict === false) issues.push('alwaysStrict=false');
	if (Object.hasOwn(compilerOptions, 'ignoreDeprecations')) issues.push('ignoreDeprecations');
	return issues.sort();
}

function lockedTypeScriptVersion(lockText: string): string | null {
	return /"typescript"\s*:\s*\["typescript@([^"\]]+)"/u.exec(lockText)?.[1] ?? null;
}

function expectedCompatibilityAlias(epoch: TypeScriptEpoch): string {
	return `npm:${epoch.compatibilityApi.package}@^${epoch.compatibilityApi.version}`;
}

function expectedNativeAlias(epoch: TypeScriptEpoch): string {
	return `npm:${epoch.nativeCli.package}@^${epoch.nativeCli.version}`;
}

function phaseIndex(phase: EpochPhase): number {
	return PHASES.indexOf(phase);
}

export function checkTypeScript7Epoch({
	epoch = readJson<TypeScriptEpoch>(epochPath),
}: {
	epoch?: TypeScriptEpoch;
} = {}): void {
	if (epoch.schemaVersion !== 1 || !PHASES.includes(epoch.phase)) {
		throw new Error('TypeScript 7 epoch must use schemaVersion 1 and a known phase');
	}
	if (canonical(epoch.stages.map(({ id }) => id)) !== canonical(PHASES)
		|| epoch.stages.length !== PHASES.length
		|| epoch.stages.some((stage, index) => stage.id !== PHASES[index] || stage.requires.length < 2)) {
		throw new Error('TypeScript 7 epoch stages must preserve the complete ordered migration topology');
	}
	if (canonical(epoch.ts6DeprecatedConfig) !== canonical(KNOWN_DEPRECATED_CONFIG)) {
		throw new Error('TypeScript 7 epoch deprecated-config inventory drifted');
	}
	if (epoch.compatibilityApi.package !== '@typescript/typescript6'
		|| epoch.compatibilityApi.version !== '6.0.2'
		|| epoch.compatibilityApi.plannedAlias !== 'typescript') {
		throw new Error('TypeScript 6 compatibility API identity drifted');
	}
	if (epoch.nativeCli.package !== 'typescript'
		|| epoch.nativeCli.version !== '7.0.2'
		|| epoch.nativeCli.plannedAlias !== '@typescript/native') {
		throw new Error('TypeScript 7 native CLI identity drifted');
	}

	const packagePaths = epoch.compatibilityApi.plannedPackagePaths ?? [];
	if (packagePaths.length === 0 || new Set(packagePaths).size !== packagePaths.length) {
		throw new Error('TypeScript compatibility package owners must be unique and non-empty');
	}
	const packageDocuments = new Map<string, PackageDocument>();
	for (const packagePath of packagePaths) {
		const absolute = resolve(workspaceDir, packagePath);
		if (!existsSync(absolute)) throw new Error(`TypeScript package owner is missing: ${packagePath}`);
		const document = readJson<PackageDocument>(absolute);
		packageDocuments.set(packagePath, document);
		if (!dependencyValue(document, 'typescript')) {
			throw new Error(`TypeScript package owner does not declare typescript: ${packagePath}`);
		}
	}
	const nativePackagePath = epoch.nativeCli.plannedPackagePath;
	if (!nativePackagePath || !packageDocuments.has(nativePackagePath)) {
		throw new Error('TypeScript native CLI owner must be one of the compatibility package owners');
	}

	const consumers = epoch.programmaticApiConsumers;
	if (consumers.length === 0 || new Set(consumers.map(({ path }) => path)).size !== consumers.length) {
		throw new Error('TypeScript programmatic API consumers must be unique and non-empty');
	}
	const syncPublic = readFileSync(syncPublicPath, 'utf8');
	for (const consumer of consumers) {
		if (!packageDocuments.has(consumer.packagePath)) {
			throw new Error(`${consumer.path}: API consumer package owner is outside the compatibility plan`);
		}
		const absolute = resolve(workspaceDir, consumer.path);
		if (!existsSync(absolute)) throw new Error(`TypeScript API consumer is missing: ${consumer.path}`);
		const source = readFileSync(absolute, 'utf8');
		if (!/from\s+['"]typescript['"]/u.test(source) || !source.includes(consumer.marker)) {
			throw new Error(`${consumer.path}: TypeScript API consumer marker/import drifted`);
		}
		if (consumer.publicProjection && !syncPublic.includes(`'${consumer.path}'`)) {
			throw new Error(`${consumer.path}: public TypeScript API consumer is not projected by sync-public`);
		}
	}

	for (const configPath of collectTsConfigPaths()) {
		const document = readJson<{ compilerOptions?: Record<string, unknown> }>(configPath);
		const deprecated = deprecatedCompilerOptions(document.compilerOptions ?? {});
		if (deprecated.length > 0) {
			throw new Error(
				`${relative(workspaceDir, configPath).replaceAll('\\', '/')}: TypeScript 6/7 deprecated config remains: ${deprecated.join(', ')}`,
			);
		}
	}

	const lockVersion = lockedTypeScriptVersion(readFileSync(lockPath, 'utf8'));
	const currentPhaseIndex = phaseIndex(epoch.phase);
	const ts6PhaseIndex = phaseIndex('ts6-api-clean');
	const dualPhaseIndex = phaseIndex('dual-cli');
	if (currentPhaseIndex < ts6PhaseIndex) {
		if (lockVersion !== epoch.currentLockedVersion) {
			throw new Error(`TypeScript compatibility-prep lock drifted: expected ${epoch.currentLockedVersion}, found ${lockVersion ?? 'none'}`);
		}
		for (const [packagePath, document] of packageDocuments) {
			if (dependencyValue(document, 'typescript') === expectedCompatibilityAlias(epoch)) {
				throw new Error(`${packagePath}: TypeScript 6 alias landed before the epoch advanced`);
			}
			if (dependencyValue(document, epoch.nativeCli.plannedAlias)) {
				throw new Error(`${packagePath}: TypeScript 7 native alias landed before the epoch advanced`);
			}
		}
	} else {
		for (const [packagePath, document] of packageDocuments) {
			if (dependencyValue(document, 'typescript') !== expectedCompatibilityAlias(epoch)) {
				throw new Error(`${packagePath}: TypeScript 6 compatibility alias is missing for phase ${epoch.phase}`);
			}
		}
	}
	if (currentPhaseIndex >= dualPhaseIndex) {
		const root = packageDocuments.get(nativePackagePath);
		if (!root || dependencyValue(root, epoch.nativeCli.plannedAlias) !== expectedNativeAlias(epoch)) {
			throw new Error(`TypeScript 7 native CLI alias is missing for phase ${epoch.phase}`);
		}
	}

	const revalidation = readJson<DependencyRevalidation>(revalidationPath);
	const typescript = revalidation.entries?.find(({ dependency }) => dependency === 'typescript');
	if (!typescript
		|| typescript.lockedVersion !== epoch.currentLockedVersion
		|| typescript.observedLatest !== epoch.nativeCli.version
		|| typescript.lane !== 'TYPESCRIPT-7-EPOCH') {
		throw new Error('TypeScript dependency revalidation does not match the compiler epoch');
	}
	console.log(
		`✓ TypeScript 7 epoch: phase=${epoch.phase}, apiConsumers=${consumers.length}, lock=${lockVersion ?? 'transition'}`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkTypeScript7Epoch();
}
