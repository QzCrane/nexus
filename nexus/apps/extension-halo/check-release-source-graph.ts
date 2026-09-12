// goal: prove every source module reachable from a production HALO entry belongs to release-admitted inventory
// inv: source/catalog presence alone can never make tools/scripts/system implementation code reachable from production entries

import ts from 'typescript-compiler-api';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RELEASE_ADMITTED_PLUGIN_IDS,
	RELEASE_CONTENT_SCRIPTS,
	RELEASE_SCRIPT_RUNTIME_IDS,
	RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES,
	RELEASE_EXTENSION_WORKER_ENTRIES,
} from './src/kernel/registry/_generated-release-admission';

const __filename = fileURLToPath(import.meta.url);
const appRoot = path.dirname(__filename);
const srcRoot = path.join(appRoot, 'src');
const admittedIds = new Set<string>(RELEASE_ADMITTED_PLUGIN_IDS);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

function normalizedRelative(file: string): string {
	return path.relative(appRoot, file).replaceAll('\\', '/');
}

function pluginIdentity(file: string): { kind: string; id: string } | null {
	const relative = normalizedRelative(file);
	const match = /^src\/(tools|scripts|system)\/([^/]+)(?:\/|$)/u.exec(relative);
	return match?.[1] && match[2] ? { kind: match[1], id: match[2] } : null;
}

function emittedSpecifierCandidates(unresolved: string): string[] {
	const extension = path.extname(unresolved);
	if (!extension) {
		return [
			...SOURCE_EXTENSIONS.map((candidateExtension) => `${unresolved}${candidateExtension}`),
			...SOURCE_EXTENSIONS.map((candidateExtension) => path.join(unresolved, `index${candidateExtension}`)),
		];
	}
	const base = unresolved.slice(0, -extension.length);
	switch (extension) {
		case '.js':
			return [`${base}.ts`, `${base}.tsx`, `${base}.js`, unresolved];
		case '.jsx':
			return [`${base}.tsx`, `${base}.jsx`, unresolved];
		case '.mjs':
			return [`${base}.mts`, `${base}.mjs`, unresolved];
		case '.cjs':
			return [`${base}.cts`, `${base}.cjs`, unresolved];
		default:
			return [unresolved];
	}
}

export function resolveSourceModule(importer: string, specifier: string): string | null {
	if (!specifier.startsWith('.')) return null;
	const unresolved = path.resolve(path.dirname(importer), specifier);
	for (const candidate of emittedSpecifierCandidates(unresolved)) {
		if (!existsSync(candidate)) continue;
		const relative = path.relative(appRoot, candidate);
		if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
		return candidate;
	}
	return null;
}

function importSpecifiers(file: string): string[] {
	const source = readFileSync(file, 'utf8');
	const kind = file.endsWith('.tsx') || file.endsWith('.jsx')
		? ts.ScriptKind.TSX
		: file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
			? ts.ScriptKind.JS
			: ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
	const specifiers = new Set<string>();
	const addLiteral = (node: ts.Expression | undefined): void => {
		if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			addLiteral(node.moduleSpecifier);
		} else if (ts.isCallExpression(node)) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword) addLiteral(node.arguments[0]);
			if (ts.isIdentifier(node.expression)
				&& node.expression.text === 'require'
				&& node.arguments.length === 1) addLiteral(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...specifiers].sort();
}

function packagedScriptEntries(): string[] {
	const entries: string[] = [];
	for (const id of RELEASE_SCRIPT_RUNTIME_IDS) {
		for (const root of ['tools', 'scripts'] as const) {
			for (const extension of ['.ts', '.js'] as const) {
				const candidate = path.join(srcRoot, root, id, `script${extension}`);
				if (existsSync(candidate)) entries.push(candidate);
			}
		}
	}
	return entries;
}

function productionEntries(): string[] {
	const relativeEntries = [
		'src/entry/content.ts',
		...RELEASE_CONTENT_SCRIPTS.map((entry) => entry.entry),
		...RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES.map((entry) => entry.entry),
		...RELEASE_EXTENSION_WORKER_ENTRIES.map((entry) => entry.entry),
		'src/entry/background.ts',
		'src/entry/sidepanel.tsx',
		'src/entry/sidepanel-init.ts',
	];
	return [
		...relativeEntries.map((entry) => path.resolve(appRoot, entry)),
		...packagedScriptEntries(),
	];
}

export interface ReleaseSourceGraphViolation {
	entry: string;
	importer: string;
	imported: string;
	pluginId: string;
	pluginKind: string;
}

export function findReleaseSourceGraphViolations(): ReleaseSourceGraphViolation[] {
	const violations: ReleaseSourceGraphViolation[] = [];
	for (const root of productionEntries()) {
		if (!existsSync(root)) throw new Error(`HALO production source entry is missing: ${normalizedRelative(root)}`);
		const visited = new Set<string>();
		const queue: Array<{ file: string; entry: string }> = [{ file: root, entry: root }];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current || visited.has(current.file)) continue;
			visited.add(current.file);
			const identity = pluginIdentity(current.file);
			if (identity && !admittedIds.has(identity.id)) {
				violations.push({
					entry: normalizedRelative(current.entry),
					importer: normalizedRelative(current.file),
					imported: normalizedRelative(current.file),
					pluginId: identity.id,
					pluginKind: identity.kind,
				});
				continue;
			}
			for (const specifier of importSpecifiers(current.file)) {
				const resolved = resolveSourceModule(current.file, specifier);
				if (!resolved || visited.has(resolved)) continue;
				const importedIdentity = pluginIdentity(resolved);
				if (importedIdentity && !admittedIds.has(importedIdentity.id)) {
					violations.push({
						entry: normalizedRelative(current.entry),
						importer: normalizedRelative(current.file),
						imported: normalizedRelative(resolved),
						pluginId: importedIdentity.id,
						pluginKind: importedIdentity.kind,
					});
					continue;
				}
				queue.push({ file: resolved, entry: current.entry });
			}
		}
	}
	return violations.sort((left, right) => (
		left.entry.localeCompare(right.entry)
		|| left.imported.localeCompare(right.imported)
		|| left.importer.localeCompare(right.importer)
	));
}

export function checkReleaseSourceGraph(): void {
	const violations = findReleaseSourceGraphViolations();
	if (violations.length > 0) {
		throw new Error(
			`HALO production source graph reaches catalog-only implementation:\n${violations.map((violation) => (
				`- ${violation.entry}: ${violation.importer} -> ${violation.imported} (${violation.pluginKind}/${violation.pluginId})`
			)).join('\n')}`,
		);
	}
	console.log(`✓ HALO release source graph: ${productionEntries().length} roots reach only release-admitted plugin implementation`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	checkReleaseSourceGraph();
}
