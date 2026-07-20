#!/usr/bin/env node

/**
 * NEXUS documentation architecture checker.
 *
 * Validates frontmatter, lifecycle redirects, generated compatibility mirrors,
 * exact-case local links, canonical entrypoints, H1 structure, owner uniqueness,
 * and documentation reachability.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

const VALID_TYPES = new Set(['tutorial', 'how-to', 'reference', 'explanation']);
const VALID_STATUSES = new Set(['stable', 'draft', 'deprecated', 'archived']);
const VALID_AUDIENCES = new Set(['all', 'developer', 'reviewer', 'contributor', 'user']);
const IGNORED_DIRECTORIES = new Set(['.git', '.turbo', 'build', 'coverage', 'dist', 'node_modules']);

/**
 * Cross-platform compatibility projections that must remain byte-identical to
 * their canonical owner. A mirror has no independent edit authority.
 */
const REGISTERED_MARKDOWN_MIRRORS = new Map([
	[
		'nexus/apps/extension-spectra/docs/control-architecture.md',
		'nexus/apps/extension-spectra/docs/control/04a-algorithm-matrix.md',
	],
]);

const REQUIRED_ENTRYPOINTS = [
	'README.md',
	'AGENTS.md',
	'CLAUDE.md',
	'nexus/README.md',
	'nexus/docs/README.md',
	'nexus/docs/engineering/README.md',
	'nexus/docs/product/roadmap.md',
	'nexus/docs/product/business-model.md',
	'nexus/docs/research/README.md',
	'nexus/apps/extension-spectra/README.md',
	'nexus/apps/extension-spectra/docs/README.md',
	'nexus/apps/extension-spectra/docs/control/README.md',
	'nexus/apps/extension-spectra/docs/architecture/runtime.md',
	'nexus/apps/extension-spectra/docs/reference/protocols.md',
	'nexus/apps/extension-spectra/docs/security/remote-control.md',
	'nexus/apps/extension-spectra/docs/roadmap.md',
	'nexus/apps/extension-halo/README.md',
	'nexus/apps/extension-halo/docs/README.md',
	'nexus/apps/extension-halo/docs/architecture.md',
	'nexus/apps/extension-halo/docs/roadmap.md',
	'nexus/apps/extension-halo/docs/research/README.md',
	'nexus/apps/extension-halo/docs/proposals/README.md',
];

const GRAPH_ROOTS = [
	'README.md',
	'AGENTS.md',
	'nexus/docs/README.md',
	'nexus/apps/extension-spectra/README.md',
	'nexus/apps/extension-halo/README.md',
];

function normalizePath(filePath) {
	return relative(repositoryRoot, filePath).split(sep).join('/');
}

function parseArguments(argv) {
	const result = { paths: [], strict: false };
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--strict') {
			result.strict = true;
		} else if (argument === '--path') {
			const value = argv[index + 1];
			if (!value) throw new Error('--path requires a file or directory');
			result.paths.push(resolve(repositoryRoot, value));
			index += 1;
		} else if (argument === '--help' || argument === '-h') {
			console.log('Usage: bun scripts/lint-docs.mjs [--strict] [--path <file-or-directory> ...]');
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return result;
}

function collectMarkdown(target, output = []) {
	if (!existsSync(target)) return output;
	const stats = statSync(target);
	if (stats.isFile()) {
		if (extname(target).toLowerCase() === '.md') output.push(target);
		return output;
	}
	if (!stats.isDirectory()) return output;

	for (const name of readdirSync(target)) {
		if (IGNORED_DIRECTORIES.has(name)) continue;
		collectMarkdown(join(target, name), output);
	}
	return output;
}

function parseFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
	if (!match) return { body: raw, fields: {}, present: false };

	const fields = {};
	for (const line of match[1].split(/\r?\n/u)) {
		if (!line.trim() || line.trimStart().startsWith('#') || /^\s/u.test(line)) continue;
		const separator = line.indexOf(':');
		if (separator < 0) continue;
		fields[line.slice(0, separator).trim()] = line
			.slice(separator + 1)
			.trim()
			.replace(/^['"]|['"]$/gu, '');
	}
	return { body: match[2], fields, present: true };
}

function isDetailedArchive(relativePath) {
	return relativePath.includes('/_archive/') && !relativePath.endsWith('/README.md');
}

function isRegisteredMirror(relativePath) {
	return REGISTERED_MARKDOWN_MIRRORS.has(relativePath);
}

function requiresDiataxis(relativePath) {
	if (isDetailedArchive(relativePath) || isRegisteredMirror(relativePath)) return false;
	return (
		relativePath === 'spectra.md' ||
		relativePath === 'nexus/scripts/hooks/README.md' ||
		relativePath.startsWith('nexus/docs/') ||
		relativePath.startsWith('nexus/apps/extension-spectra/docs/') ||
		relativePath.startsWith('nexus/apps/extension-halo/docs/')
	);
}

function removeCodeFences(markdown) {
	return markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '');
}

function countH1(markdown) {
	return [...removeCodeFences(markdown).matchAll(/^#(?!#)\s+\S.*$/gmu)].length;
}

function extractRawLinks(markdown) {
	const withoutCode = removeCodeFences(markdown);
	return [
		...[...withoutCode.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/gu)].map((match) => match[1]),
		...[...withoutCode.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gmu)].map((match) => match[1]),
	];
}

function linkDestination(rawDestination) {
	const trimmed = rawDestination.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('<')) {
		const close = trimmed.indexOf('>');
		return close > 0 ? trimmed.slice(1, close) : null;
	}
	return trimmed.match(/^\S+/u)?.[0] ?? null;
}

function hasExactCase(absolutePath) {
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (repositoryRelative === '') return true;
	if (repositoryRelative.startsWith('..') || resolve(repositoryRoot, repositoryRelative) !== absolutePath) {
		return false;
	}

	let current = repositoryRoot;
	for (const segment of repositoryRelative.split(sep)) {
		if (!readdirSync(current).includes(segment)) return false;
		current = join(current, segment);
	}
	return true;
}

function resolveLocalLink(sourceFile, destination) {
	if (destination.startsWith('#') || /^(?:https?:|mailto:|tel:|data:|chrome:|about:)/iu.test(destination)) {
		return null;
	}
	if (/^(?:file:|javascript:)/iu.test(destination)) {
		return { error: `forbidden link scheme: ${destination}` };
	}

	const pathOnly = destination.split('#', 1)[0].split('?', 1)[0];
	if (!pathOnly) return null;

	let decoded;
	try {
		decoded = decodeURIComponent(pathOnly);
	} catch {
		return { error: `invalid URI encoding: ${destination}` };
	}

	const resolved = decoded.startsWith('/')
		? resolve(repositoryRoot, `.${decoded}`)
		: resolve(dirname(sourceFile), decoded);
	if (!resolved.startsWith(`${repositoryRoot}${sep}`) && resolved !== repositoryRoot) {
		return { error: `link escapes repository: ${destination}` };
	}
	if (!existsSync(resolved)) return { error: `missing local target: ${destination}` };
	if (!hasExactCase(resolved)) return { error: `local target has incorrect path casing: ${destination}` };

	const stats = statSync(resolved);
	if (stats.isDirectory() && !existsSync(join(resolved, 'README.md'))) {
		return { error: `directory link has no README.md: ${destination}` };
	}
	return { target: stats.isDirectory() ? join(resolved, 'README.md') : resolved };
}

function lintFrontmatter(relativePath, parsed) {
	if (!requiresDiataxis(relativePath)) return [];
	if (!parsed.present) return ['missing Diátaxis frontmatter'];

	const issues = [];
	if (!VALID_TYPES.has(parsed.fields.type)) {
		issues.push(`invalid or missing type: ${parsed.fields.type ?? 'missing'}`);
	}
	if (!VALID_STATUSES.has(parsed.fields.status)) {
		issues.push(`invalid or missing status: ${parsed.fields.status ?? 'missing'}`);
	}
	if (!VALID_AUDIENCES.has(parsed.fields.audience)) {
		issues.push(`invalid or missing audience: ${parsed.fields.audience ?? 'missing'}`);
	}
	return issues;
}

function lintRedirect(filePath, relativePath, parsed) {
	if (parsed.fields.status !== 'deprecated') return [];
	const issues = [];
	const redirect = parsed.fields.redirect_to;
	if (!redirect) {
		issues.push('deprecated document is missing redirect_to');
	} else {
		const resolved = resolveLocalLink(filePath, redirect);
		if (resolved?.error) issues.push(`invalid redirect_to: ${resolved.error}`);
		if (resolved?.target && normalizePath(resolved.target) === relativePath) {
			issues.push('redirect_to points to itself');
		}
	}
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(parsed.fields.remove_after ?? '')) {
		issues.push('deprecated document requires remove_after: YYYY-MM-DD');
	}
	const words = parsed.body.trim().split(/\s+/u).filter(Boolean).length;
	if (words > 220) issues.push(`deprecated alias is too large (${words} words; maximum 220)`);
	return issues;
}

function lintRegisteredMirror(filePath, relativePath) {
	const targetRelativePath = REGISTERED_MARKDOWN_MIRRORS.get(relativePath);
	if (!targetRelativePath) return [`unregistered Markdown compatibility mirror: ${relativePath}`];

	const targetPath = resolve(repositoryRoot, targetRelativePath);
	if (!existsSync(targetPath)) return [`compatibility mirror target is missing: ${targetRelativePath}`];
	if (!hasExactCase(targetPath)) return [`compatibility mirror target has incorrect case: ${targetRelativePath}`];
	if (readFileSync(filePath, 'utf8') !== readFileSync(targetPath, 'utf8')) {
		return [`compatibility mirror drifted from canonical owner: ${targetRelativePath}`];
	}
	return [];
}

function lintFile(filePath) {
	const relativePath = normalizePath(filePath);
	if (isRegisteredMirror(relativePath)) {
		return {
			issues: lintRegisteredMirror(filePath, relativePath),
			linkTargets: [REGISTERED_MARKDOWN_MIRRORS.get(relativePath)],
			parsed: { fields: { status: 'deprecated' } },
			relativePath,
			mirror: true,
		};
	}

	const parsed = parseFrontmatter(readFileSync(filePath, 'utf8'));
	const issues = [
		...lintFrontmatter(relativePath, parsed),
		...lintRedirect(filePath, relativePath, parsed),
	];
	if (!isDetailedArchive(relativePath)) {
		const h1Count = countH1(parsed.body);
		if (h1Count !== 1) issues.push(`expected exactly one H1, found ${h1Count}`);
	}

	const linkTargets = [];
	if (!isDetailedArchive(relativePath)) {
		for (const rawLink of extractRawLinks(parsed.body)) {
			const destination = linkDestination(rawLink);
			if (!destination) continue;
			const resolved = resolveLocalLink(filePath, destination);
			if (resolved?.error) issues.push(resolved.error);
			if (resolved?.target && extname(resolved.target).toLowerCase() === '.md') {
				linkTargets.push(normalizePath(resolved.target));
			}
		}
	}
	return { issues, linkTargets, parsed, relativePath, mirror: false };
}

function isCanonicalInternalDocument(result) {
	return (
		!result.mirror &&
		requiresDiataxis(result.relativePath) &&
		!isDetailedArchive(result.relativePath) &&
		!['deprecated', 'archived'].includes(result.parsed.fields.status)
	);
}

function findOrphans(resultsByPath) {
	const reachable = new Set();
	const queue = GRAPH_ROOTS.filter((root) => resultsByPath.has(root));
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || reachable.has(current)) continue;
		reachable.add(current);
		for (const target of resultsByPath.get(current)?.linkTargets ?? []) {
			if (resultsByPath.has(target) && !reachable.has(target)) queue.push(target);
		}
	}
	return [...resultsByPath.values()]
		.filter(isCanonicalInternalDocument)
		.filter((result) => !reachable.has(result.relativePath))
		.map((result) => result.relativePath)
		.sort();
}

function findDuplicateOwners(resultsByPath) {
	const byOwner = new Map();
	for (const result of resultsByPath.values()) {
		if (!isCanonicalInternalDocument(result)) continue;
		if (result.parsed.fields.status !== 'stable') continue;
		const owner = result.parsed.fields.owner;
		if (!owner) continue;
		const paths = byOwner.get(owner) ?? [];
		paths.push(result.relativePath);
		byOwner.set(owner, paths);
	}
	return [...byOwner.entries()]
		.filter(([, paths]) => paths.length > 1)
		.map(([owner, paths]) => ({ owner, paths: paths.sort() }));
}

function main() {
	const args = parseArguments(process.argv);
	const scanTargets = args.paths.length > 0 ? args.paths : [repositoryRoot];
	const markdownFiles = [...new Set(scanTargets.flatMap((target) => collectMarkdown(target)))].sort(
		(left, right) => normalizePath(left).localeCompare(normalizePath(right)),
	);
	const globalScan = args.paths.length === 0;
	const failures = [];
	const resultsByPath = new Map();

	if (globalScan) {
		for (const entrypoint of REQUIRED_ENTRYPOINTS) {
			if (!existsSync(resolve(repositoryRoot, entrypoint))) {
				failures.push({ path: entrypoint, issue: 'required documentation entrypoint is missing' });
			}
		}
	}

	for (const filePath of markdownFiles) {
		const result = lintFile(filePath);
		resultsByPath.set(result.relativePath, result);
		for (const issue of result.issues) failures.push({ path: result.relativePath, issue });
	}

	if (globalScan) {
		for (const orphan of findOrphans(resultsByPath)) {
			failures.push({ path: orphan, issue: 'active canonical document is unreachable from documentation entrypoints' });
		}
		for (const duplicate of findDuplicateOwners(resultsByPath)) {
			for (const path of duplicate.paths) {
				failures.push({
					path,
					issue: `stable owner "${duplicate.owner}" is duplicated across: ${duplicate.paths.join(', ')}`,
				});
			}
		}
	}

	if (failures.length > 0) {
		console.error(`[docs:check] ${failures.length} issue(s) across ${markdownFiles.length} Markdown file(s):`);
		for (const failure of failures) console.error(`  ${failure.path}: ${failure.issue}`);
		process.exit(1);
	}

	console.log(`[docs:check] ${markdownFiles.length} Markdown file(s) passed`);
	console.log(
		`[docs:check] entrypoints=${REQUIRED_ENTRYPOINTS.length} mirrors=${REGISTERED_MARKDOWN_MIRRORS.size} strict=${args.strict}`,
	);
}

main();
