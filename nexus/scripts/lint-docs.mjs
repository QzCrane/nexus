#!/usr/bin/env node

/**
 * NEXUS documentation architecture checker.
 *
 * Enforces structural ownership and lifecycle rules in addition to frontmatter:
 * - canonical documentation entrypoints exist;
 * - active internal docs use valid Diátaxis frontmatter;
 * - deprecated aliases declare a valid redirect and removal date;
 * - local Markdown links resolve with exact case;
 * - active canonical docs are reachable from documentation entrypoints;
 * - every checked document has exactly one H1.
 *
 * Usage:
 *   bun scripts/lint-docs.mjs
 *   bun scripts/lint-docs.mjs --strict
 *   bun scripts/lint-docs.mjs --path nexus/apps/extension-spectra/docs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

const VALID_TYPES = new Set(['tutorial', 'how-to', 'reference', 'explanation']);
const VALID_STATUSES = new Set(['stable', 'draft', 'deprecated', 'archived']);
const VALID_AUDIENCES = new Set(['all', 'developer', 'reviewer', 'contributor', 'user']);

const IGNORED_DIRECTORIES = new Set([
	'.git',
	'.turbo',
	'build',
	'coverage',
	'dist',
	'node_modules',
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
			continue;
		}
		if (argument === '--path') {
			const value = argv[index + 1];
			if (!value) throw new Error('--path requires a file or directory');
			result.paths.push(resolve(repositoryRoot, value));
			index += 1;
			continue;
		}
		if (argument === '--help' || argument === '-h') {
			console.log('Usage: bun scripts/lint-docs.mjs [--strict] [--path <file-or-directory> ...]');
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${argument}`);
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
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		if (/^\s/u.test(line)) continue;
		const separator = line.indexOf(':');
		if (separator < 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line
			.slice(separator + 1)
			.trim()
			.replace(/^['"]|['"]$/gu, '');
		fields[key] = value;
	}
	return { body: match[2], fields, present: true };
}

function isDetailedArchive(relativePath) {
	return relativePath.includes('/_archive/') && !relativePath.endsWith('/README.md');
}

function requiresDiataxis(relativePath) {
	if (isDetailedArchive(relativePath)) return false;
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
	const withoutCode = removeCodeFences(markdown);
	return [...withoutCode.matchAll(/^#(?!#)\s+\S.*$/gmu)].length;
}

function extractRawLinks(markdown) {
	const withoutCode = removeCodeFences(markdown);
	const links = [];
	for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/gu)) {
		links.push(match[1]);
	}
	for (const match of withoutCode.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gmu)) {
		links.push(match[1]);
	}
	return links;
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

function isExternalLink(destination) {
	return /^(?:https?:|mailto:|tel:|data:|chrome:|about:)/iu.test(destination);
}

function resolveLocalLink(sourceFile, destination) {
	if (destination.startsWith('#') || isExternalLink(destination)) return null;
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

	if (!existsSync(resolved)) {
		return { error: `missing local target: ${destination}` };
	}

	const stats = statSync(resolved);
	if (stats.isDirectory() && !existsSync(join(resolved, 'README.md'))) {
		return { error: `directory link has no README.md: ${destination}` };
	}

	return { target: resolved };
}

function parseIsoDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function lintFrontmatter(relativePath, parsed) {
	const issues = [];
	if (!requiresDiataxis(relativePath)) return issues;
	if (!parsed.present) return ['missing Diátaxis frontmatter'];

	const { audience, status, type } = parsed.fields;
	if (!VALID_TYPES.has(type)) {
		issues.push(`invalid or missing type: ${type ?? 'missing'}`);
	}
	if (!VALID_STATUSES.has(status)) {
		issues.push(`invalid or missing status: ${status ?? 'missing'}`);
	}
	if (!VALID_AUDIENCES.has(audience)) {
		issues.push(`invalid or missing audience: ${audience ?? 'missing'}`);
	}
	return issues;
}

function lintRedirect(filePath, relativePath, parsed) {
	if (parsed.fields.status !== 'deprecated') return [];
	const issues = [];
	const redirect = parsed.fields.redirect_to;
	const removeAfter = parsed.fields.remove_after;

	if (!redirect) {
		issues.push('deprecated document is missing redirect_to');
	} else {
		const resolved = resolveLocalLink(filePath, redirect);
		if (resolved?.error) issues.push(`invalid redirect_to: ${resolved.error}`);
		if (resolved?.target && normalizePath(resolved.target) === relativePath) {
			issues.push('redirect_to points to the deprecated document itself');
		}
	}

	if (!removeAfter || !parseIsoDate(removeAfter)) {
		issues.push('deprecated document requires remove_after: YYYY-MM-DD');
	}

	const wordCount = parsed.body.trim().split(/\s+/u).filter(Boolean).length;
	if (wordCount > 220) {
		issues.push(`deprecated alias is too large (${wordCount} words; maximum 220)`);
	}
	return issues;
}

function lintFile(filePath) {
	const relativePath = normalizePath(filePath);
	const raw = readFileSync(filePath, 'utf8');
	const parsed = parseFrontmatter(raw);
	const issues = [];

	issues.push(...lintFrontmatter(relativePath, parsed));
	issues.push(...lintRedirect(filePath, relativePath, parsed));

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
			if (resolved?.target && statSync(resolved.target).isDirectory()) {
				linkTargets.push(normalizePath(join(resolved.target, 'README.md')));
			}
		}
	}

	return { issues, linkTargets, parsed, relativePath };
}

function isCanonicalInternalDocument(result) {
	return (
		requiresDiataxis(result.relativePath) &&
		!isDetailedArchive(result.relativePath) &&
		result.parsed.fields.status !== 'deprecated' &&
		result.parsed.fields.status !== 'archived'
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

function main() {
	const args = parseArguments(process.argv);
	const scanTargets = args.paths.length > 0 ? args.paths : [repositoryRoot];
	const markdownFiles = [...new Set(scanTargets.flatMap((target) => collectMarkdown(target)))]
		.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));

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
	}

	if (failures.length > 0) {
		console.error(`[docs:check] ${failures.length} issue(s) across ${markdownFiles.length} Markdown file(s):`);
		for (const failure of failures) console.error(`  ${failure.path}: ${failure.issue}`);
		process.exit(1);
	}

	console.log(`[docs:check] ${markdownFiles.length} Markdown file(s) passed`);
	console.log(`[docs:check] entrypoints=${REQUIRED_ENTRYPOINTS.length} strict=${args.strict}`);
}

main();
