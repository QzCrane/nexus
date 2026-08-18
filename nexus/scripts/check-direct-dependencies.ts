// goal: make direct dependency usage/classification debt executable instead of relying on periodic manual package.json review
// inv: external runtime directs need a live shipped owner or explicit build owner; source imports replaced out of production are development dependencies, not runtime dependencies

import ts from 'typescript';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'direct-dependency-policy.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

interface PackageDocument {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

interface AcceptedException {
	packagePath: string;
	dependency: string;
	evidencePath: string;
	marker: string;
	reason: string;
	replacesSourceRuntimeDependencies?: string[];
}

interface DebtEntry {
	packagePath: string;
	section: 'dependencies' | 'devDependencies';
	dependency: string;
	kind:
		| 'unused-runtime-direct'
		| 'type-package-in-runtime-dependencies'
		| 'orphan-type-direct'
		| 'source-import-not-shipped-runtime';
	resolution: string;
}

interface DirectDependencyPolicy {
	schemaVersion: 1;
	acceptedNonSourceRuntimeUse: AcceptedException[];
	knownDebt: DebtEntry[];
}

export interface DirectDependencyIssue {
	packagePath: string;
	section: 'dependencies' | 'devDependencies';
	dependency: string;
	kind: DebtEntry['kind'];
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function packageManifestPaths(): string[] {
	const manifests = [resolve(workspaceDir, 'package.json')];
	for (const collection of ['apps', 'packages']) {
		const root = resolve(workspaceDir, collection);
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const candidate = join(root, entry.name, 'package.json');
			if (existsSync(candidate)) manifests.push(candidate);
			if (collection === 'packages' && entry.name === 'features') {
				for (const feature of readdirSync(join(root, entry.name), { withFileTypes: true })) {
					if (!feature.isDirectory()) continue;
					const featureManifest = join(root, entry.name, feature.name, 'package.json');
					if (existsSync(featureManifest)) manifests.push(featureManifest);
				}
			}
		}
	}
	return manifests.sort();
}

function walkSource(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const candidate = join(directory, entry.name);
		if (entry.isDirectory()) return walkSource(candidate);
		const extension = entry.name.slice(entry.name.lastIndexOf('.'));
		return SOURCE_EXTENSIONS.has(extension) ? [candidate] : [];
	});
}

function directPackageName(specifier: string): string | null {
	if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
	const parts = specifier.split('/');
	if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
	return parts[0] ?? null;
}

function importSpecifiers(file: string): string[] {
	const source = readFileSync(file, 'utf8');
	const kind = file.endsWith('.tsx') || file.endsWith('.jsx')
		? ts.ScriptKind.TSX
		: file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
			? ts.ScriptKind.JS
			: ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
	const packages = new Set<string>();
	const add = (node: ts.Expression | undefined): void => {
		if (!node || !ts.isStringLiteralLike(node)) return;
		const name = directPackageName(node.text);
		if (name) packages.add(name);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
		else if (ts.isCallExpression(node)) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
			if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1) {
				add(node.arguments[0]);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...packages];
}

function sourceDependencies(packageDir: string): Set<string> {
	const dependencies = new Set<string>();
	for (const file of walkSource(join(packageDir, 'src'))) {
		for (const dependency of importSpecifiers(file)) dependencies.add(dependency);
	}
	return dependencies;
}

function typePackageTarget(name: string): string | null {
	if (!name.startsWith('@types/')) return null;
	const encoded = name.slice('@types/'.length);
	const scopedSeparator = encoded.indexOf('__');
	if (scopedSeparator >= 0) {
		return `@${encoded.slice(0, scopedSeparator)}/${encoded.slice(scopedSeparator + 2)}`;
	}
	return encoded || null;
}

function key(issue: Pick<DirectDependencyIssue, 'packagePath' | 'section' | 'dependency' | 'kind'>): string {
	return `${issue.packagePath}\0${issue.section}\0${issue.dependency}\0${issue.kind}`;
}

export function findDirectDependencyIssues(
	policy: DirectDependencyPolicy = readJson<DirectDependencyPolicy>(policyPath),
): DirectDependencyIssue[] {
	if (policy.schemaVersion !== 1) throw new Error('direct dependency policy schemaVersion must be 1');
	const exceptionKeys = new Set<string>();
	const replacedSourceRuntimeDependencies = new Map<string, Set<string>>();
	for (const exception of policy.acceptedNonSourceRuntimeUse ?? []) {
		const id = `${exception.packagePath}\0${exception.dependency}`;
		if (exceptionKeys.has(id)) throw new Error(`duplicate direct dependency exception: ${exception.packagePath}:${exception.dependency}`);
		exceptionKeys.add(id);
		if (!exception.reason || exception.reason.trim().length < 24) {
			throw new Error(`${exception.packagePath}:${exception.dependency} exception requires a concrete reason`);
		}
		const manifestPath = resolve(workspaceDir, exception.packagePath);
		const manifest = readJson<PackageDocument>(manifestPath);
		if (!manifest.dependencies?.[exception.dependency]) {
			throw new Error(`${exception.packagePath}:${exception.dependency} exception no longer names a runtime dependency`);
		}
		const imports = sourceDependencies(dirname(manifestPath));
		if (imports.has(exception.dependency)) {
			throw new Error(`${exception.packagePath}:${exception.dependency} exception is stale because src now imports it directly`);
		}
		const evidencePath = resolve(workspaceDir, exception.evidencePath);
		if (!existsSync(evidencePath) || !readFileSync(evidencePath, 'utf8').includes(exception.marker)) {
			throw new Error(`${exception.packagePath}:${exception.dependency} exception evidence is stale`);
		}

		const replaced = exception.replacesSourceRuntimeDependencies ?? [];
		if (new Set(replaced).size !== replaced.length) {
			throw new Error(`${exception.packagePath}:${exception.dependency} replacement targets contain duplicates`);
		}
		const targetSet = replacedSourceRuntimeDependencies.get(exception.packagePath) ?? new Set<string>();
		for (const target of replaced) {
			if (!target || target === exception.dependency) {
				throw new Error(`${exception.packagePath}:${exception.dependency} has an invalid replacement target`);
			}
			if (targetSet.has(target)) {
				throw new Error(`${exception.packagePath}:${target} is replaced by more than one runtime exception`);
			}
			if (!manifest.dependencies?.[target] && !manifest.devDependencies?.[target]) {
				throw new Error(`${exception.packagePath}:${target} replacement target is not a direct dependency`);
			}
			if (!imports.has(target)) {
				throw new Error(`${exception.packagePath}:${target} replacement target is not imported by src`);
			}
			targetSet.add(target);
		}
		replacedSourceRuntimeDependencies.set(exception.packagePath, targetSet);
	}

	const issues: DirectDependencyIssue[] = [];
	const packageState = new Map<string, { manifest: PackageDocument; imports: Set<string> }>();
	for (const manifestPath of packageManifestPaths()) {
		const packagePath = manifestPath.slice(workspaceDir.length + 1).replaceAll('\\', '/');
		const manifest = readJson<PackageDocument>(manifestPath);
		const imports = sourceDependencies(dirname(manifestPath));
		packageState.set(packagePath, { manifest, imports });
		const replaced = replacedSourceRuntimeDependencies.get(packagePath) ?? new Set<string>();
		for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
			if (version.startsWith('workspace:')) continue;
			if (dependency.startsWith('@types/')) {
				issues.push({
					packagePath,
					section: 'dependencies',
					dependency,
					kind: 'type-package-in-runtime-dependencies',
				});
				continue;
			}
			if (imports.has(dependency)) {
				if (replaced.has(dependency)) {
					issues.push({
						packagePath,
						section: 'dependencies',
						dependency,
						kind: 'source-import-not-shipped-runtime',
					});
				}
				continue;
			}
			if (exceptionKeys.has(`${packagePath}\0${dependency}`)) continue;
			issues.push({
				packagePath,
				section: 'dependencies',
				dependency,
				kind: 'unused-runtime-direct',
			});
		}
	}

	for (const debt of policy.knownDebt ?? []) {
		if (debt.kind !== 'orphan-type-direct') continue;
		const state = packageState.get(debt.packagePath);
		const version = state?.manifest[debt.section]?.[debt.dependency];
		if (!version) continue;
		const target = typePackageTarget(debt.dependency);
		if (!target) throw new Error(`${debt.packagePath}:${debt.dependency} orphan-type-direct must be an @types package`);
		if (!state?.manifest.dependencies?.[target] || !state.imports.has(target)) {
			issues.push({
				packagePath: debt.packagePath,
				section: debt.section,
				dependency: debt.dependency,
				kind: debt.kind,
			});
		}
	}
	return issues.sort((left, right) => key(left).localeCompare(key(right)));
}

export function checkDirectDependencies(
	policy: DirectDependencyPolicy = readJson<DirectDependencyPolicy>(policyPath),
): void {
	const actual = findDirectDependencyIssues(policy);
	const expected = [...(policy.knownDebt ?? [])].sort((left, right) => key(left).localeCompare(key(right)));
	const actualKeys = actual.map(key);
	const expectedKeys = expected.map(key);
	if (actualKeys.join('\n') !== expectedKeys.join('\n')) {
		const actualSet = new Set(actualKeys);
		const expectedSet = new Set(expectedKeys);
		const unexpected = actual.filter((issue) => !expectedSet.has(key(issue)));
		const stale = expected.filter((issue) => !actualSet.has(key(issue)));
		throw new Error(
			`Direct dependency debt drifted.\nUnexpected: ${JSON.stringify(unexpected)}\nStale policy debt: ${JSON.stringify(stale)}`,
		);
	}
	for (const debt of expected) {
		if (!debt.resolution || debt.resolution.trim().length < 24) {
			throw new Error(`${debt.packagePath}:${debt.dependency} debt requires a concrete resolution`);
		}
	}
	console.log(`✓ Direct dependency policy: ${packageManifestPaths().length} packages; knownDebt=${expected.length}; acceptedNonSource=${policy.acceptedNonSourceRuntimeUse.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkDirectDependencies();
}
