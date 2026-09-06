// goal: keep the actual native CLI and programmatic compiler API identities independently verified
// inv: adopting current main does not invent past migration evidence or permit a CLI import to replace the API

import ts from 'typescript-compiler-api';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['.git', '.turbo', 'dist', 'node_modules', 'release', 'test-results', 'playwright-report', 'artifacts']);
const SOURCE = /\.[cm]?[jt]sx?$/u;

interface ApiConsumer { path: string; packagePath: string; marker: string; role: string; publicProjection: boolean }
export interface TypeScriptEpoch {
	schemaVersion: 2;
	phase: 'native-default';
	adoptedFromCommit: string;
	validationScope: string;
	nativeCli: { package: string; version: string; packagePaths: string[] };
	compatibilityApi: { package: string; version: string; alias: string; packagePath: string; reason: string };
	programmaticApiConsumers: ApiConsumer[];
	ts6DeprecatedConfig: string[];
	nextEpochRequirements: string[];
}
interface PackageDocument { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
function declared(document: PackageDocument, name: string) { return document.dependencies?.[name] ?? document.devDependencies?.[name]; }
function canonical(values: readonly string[]) { return [...values].sort().join('\0'); }
function owned(path: string) {
	const absolute = resolve(workspaceDir, path);
	const normalized = relative(workspaceDir, absolute);
	if (normalized.startsWith('..') || !existsSync(absolute)) throw new Error(`TypeScript owner is missing or outside workspace: ${path}`);
	return absolute;
}
function walk(directory = workspaceDir): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isSymbolicLink()) return [];
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : walk(path);
		return entry.isFile() ? [path] : [];
	});
}

export function compilerApiImports(file: string): string[] {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const imports = new Set<string>();
	const add = (node: ts.Expression | undefined) => {
		if (node && ts.isStringLiteralLike(node)
			&& (node.text === 'typescript' || node.text === 'typescript-compiler-api')) imports.add(node.text);
	};
	const visit = (node: ts.Node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
		else if (ts.isCallExpression(node)
			&& (node.expression.kind === ts.SyntaxKind.ImportKeyword
				|| ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node.arguments[0]);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return [...imports];
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

function lockContains(lock: string, key: string, packageName: string, version: string): boolean {
	const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\["${escapeRegExp(packageName)}@${escapeRegExp(version)}"`, 'u').test(lock);
}

export function checkTypeScript7Epoch({
	epoch = readJson<TypeScriptEpoch>(resolve(workspaceDir, 'typescript-7-epoch.json')),
}: { epoch?: TypeScriptEpoch } = {}): void {
	if (epoch.schemaVersion !== 2 || epoch.phase !== 'native-default') throw new Error('TypeScript epoch must describe the actual native-default configuration phase');
	if (!/^[a-f0-9]{40}$/u.test(epoch.adoptedFromCommit) || epoch.validationScope.length < 40
		|| epoch.nextEpochRequirements.length < 3) throw new Error('TypeScript epoch needs exact adoption identity and explicit evidence boundaries');
	const { nativeCli, compatibilityApi: api } = epoch;
	if (nativeCli.package !== 'typescript' || api.package !== 'typescript' || api.alias !== 'typescript-compiler-api'
		|| !/^7\.\d+\.\d+$/u.test(nativeCli.version) || !/^6\.\d+\.\d+$/u.test(api.version)) {
		throw new Error('TypeScript CLI/API identities require a separately reviewed epoch');
	}
	const files = walk();
	const actualNativeOwners = files.filter((file) => file.endsWith('/package.json'))
		.filter((file) => Boolean(declared(readJson<PackageDocument>(file), nativeCli.package)))
		.map((file) => relative(workspaceDir, file).replaceAll('\\', '/'));
	if (new Set(nativeCli.packagePaths).size !== nativeCli.packagePaths.length
		|| canonical(actualNativeOwners) !== canonical(nativeCli.packagePaths)) throw new Error('TypeScript native CLI package owner census drifted');
	for (const path of nativeCli.packagePaths) {
		if (declared(readJson<PackageDocument>(owned(path)), nativeCli.package) !== nativeCli.version) {
			throw new Error(`${path}: TypeScript native CLI version drifted`);
		}
	}
	if (declared(readJson<PackageDocument>(owned(api.packagePath)), api.alias) !== `npm:${api.package}@${api.version}`
		|| ts.version !== api.version) throw new Error('TypeScript compiler API alias/version drifted');
	const lock = readFileSync(resolve(workspaceDir, 'bun.lock'), 'utf8');
	if (!lockContains(lock, nativeCli.package, nativeCli.package, nativeCli.version)
		|| !lockContains(lock, api.alias, api.package, api.version)) throw new Error('TypeScript compiler/API exact lock drifted');

	const actualConsumers = new Set<string>();
	for (const file of files.filter((file) => SOURCE.test(file))) {
		const imports = compilerApiImports(file);
		if (imports.includes(nativeCli.package)) throw new Error(`${relative(workspaceDir, file)}: programmatic tooling may not import the native CLI package`);
		if (imports.includes(api.alias)) actualConsumers.add(relative(workspaceDir, file).replaceAll('\\', '/'));
	}
	const consumers = epoch.programmaticApiConsumers;
	if (new Set(consumers.map(({ path }) => path)).size !== consumers.length
		|| canonical([...actualConsumers]) !== canonical(consumers.map(({ path }) => path))) throw new Error('TypeScript programmatic API consumer census drifted');
	const syncPublic = readFileSync(resolve(workspaceDir, 'scripts/sync-public.ts'), 'utf8');
	for (const consumer of consumers) {
		if (consumer.packagePath !== api.packagePath || !readFileSync(owned(consumer.path), 'utf8').includes(consumer.marker)) {
			throw new Error(`${consumer.path}: TypeScript API consumer marker/import drifted`);
		}
		if (consumer.publicProjection && !syncPublic.includes(`'${consumer.path}'`)) throw new Error(`${consumer.path}: public API consumer projection is missing`);
	}
	const banned = deprecatedCompilerOptions({ baseUrl: '.', downlevelIteration: false, moduleResolution: 'node', target: 'es5', module: 'amd', outFile: 'x', esModuleInterop: false, allowSyntheticDefaultImports: false, alwaysStrict: false, ignoreDeprecations: '6.0' });
	for (const option of banned) if (!epoch.ts6DeprecatedConfig.includes(option)) throw new Error(`TypeScript deprecated-config inventory omitted ${option}`);
	for (const file of files.filter((path) => /(?:^|\/)tsconfig(?:\.[^.]+)?\.json$/u.test(path))) {
		const parsed = ts.readConfigFile(file, ts.sys.readFile);
		if (parsed.error) throw new Error(`${relative(workspaceDir, file)}: invalid TypeScript configuration`);
		const options = (parsed.config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
		const deprecated = deprecatedCompilerOptions(options);
		if (deprecated.length) throw new Error(`${relative(workspaceDir, file)}: TypeScript 6/7 deprecated config remains: ${deprecated.join(', ')}`);
	}
	console.log(`✓ TypeScript current topology: CLI=${nativeCli.version}; API=${api.version}; packageOwners=${actualNativeOwners.length}; API consumers=${consumers.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkTypeScript7Epoch();
