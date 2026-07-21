#!/usr/bin/env bun
// ai-pitfall-detector.mjs
//
// Static heuristic scanner that catches common AI authoring pitfalls
// before they reach commit/push. Pure regex-based — accepts some false
// positives; this is an AI guard, not a type checker.
//
// Two modes:
//   1. Library: `import { scanFileContent } from './ai-pitfall-detector.mjs'`
//      returns `Issue[]` for the test runner.
//   2. CLI: `bun scripts/hooks/ai-pitfall-detector.mjs [files...]`
//      Scans each file (or `git diff --name-only` when no args given)
//      and exits 1 when any error-severity issue is found.
//
// Integrated into ai-post-write-lint.mjs so AI-written files are
// scanned immediately after Write/Edit (non-blocking: issues are
// surfaced in chat; the AI decides whether to fix).
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} Issue
 * @property {string} rule       — rule identifier (e.g. "storage-write-uncaught")
 * @property {'error'|'warn'} severity
 * @property {number} line       — 1-based line number
 * @property {number} col       — 1-based column
 * @property {string} message    — human-readable description
 */

const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = /[/\\](node_modules|dist|\.turbo|\.cache)[/\\]/;

/**
 * Check whether a given 1-based line number is inside a try-block
 * without an intervening `} catch`. Scans backward up to `window`
 * lines. Used by storage/fetch rules.
 *
 * @param {string[]} lines
 * @param {number} lineIdx  — 0-based index
 * @param {number} window   — how far back to scan (default 15)
 * @returns {boolean}
 */
function isInsideTryBlock(lines, lineIdx, window = 15) {
	for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - window); i--) {
		const line = lines[i] ?? '';
		if (/\}\s*catch\s*\(/.test(line)) return false; // exited the try
		if (/\btry\s*\{/.test(line)) return true;
	}
	return false;
}

/**
 * Check whether a given line has a `.catch(` recovery on the same
 * line or within the next 3 lines (for chained calls split across
 * lines).
 *
 * @param {string[]} lines
 * @param {number} lineIdx  — 0-based index
 * @returns {boolean}
 */
function hasAdjacentCatch(lines, lineIdx) {
	for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 4); i++) {
		const line = lines[i] ?? '';
		// End of statement — stop scanning.
		if (i > lineIdx && /;\s*$/.test(line)) return false;
		if (/\.catch\s*\(/.test(line)) return true;
	}
	return false;
}

/**
 * Check whether a file imports `isPrivateHost` (SSRF guard).
 *
 * @param {string} content
 * @returns {boolean}
 */
function importsSSRFGuard(content) {
	return /import\s+.*\bisPrivateHost\b.*from\b/.test(content);
}

/**
 * Rule 1: storage-write-uncaught
 *   - chrome.storage.<area>.set/remove/update/delete() not in try-block and
 *     without adjacent .catch()
 *   - safeStorageSet()/safeStorageRemove() same rule
 */
function checkStorageWriteUncaught(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const pattern = /\b(chrome\.storage\.(?:local|sync|session)\.(?:set|remove|update|delete)\(|safeStorage(?:Set|Remove)\s*\()/;
	lines.forEach((line, idx) => {
		if (!pattern.test(line)) return;
		if (/\bbypass-storage-check\b/.test(line)) return;
		if (isInsideTryBlock(lines, idx)) return;
		if (hasAdjacentCatch(lines, idx)) return;
		const col = line.search(pattern) + 1;
		issues.push({
			rule: 'storage-write-uncaught',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'Storage write without try/catch or .catch() — unhandled rejection risk',
		});
	});
	return issues;
}

/**
 * Rule 2: fetch-uncaught
 *   - `await fetch(` or `fetch(...).then(` not in try-block and without
 *     adjacent .catch() on the same chain.
 */
function checkFetchUncaught(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const pattern = /\b(?:await\s+)?fetch\s*\(/;
	lines.forEach((line, idx) => {
		if (!pattern.test(line)) return;
		// suppression or allow-uncaught opt-out (current line or the previous line)
		if (/\/\/\s*(biome-ignore|allow-uncaught)/.test(line)) return;
		const prevLine = lines[idx - 1] ?? '';
		if (/\/\/\s*(biome-ignore|allow-uncaught)/.test(prevLine)) return;
		if (isInsideTryBlock(lines, idx)) return;
		if (hasAdjacentCatch(lines, idx)) return;
		const col = line.search(pattern) + 1;
		issues.push({
			rule: 'fetch-uncaught',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'fetch() without try/catch or .catch() — network failure becomes unhandled rejection',
		});
	});
	return issues;
}

/**
 * Rule 3: listener-leak
 *   - File has addEventListener('X', ...) without a matching
 *     removeEventListener('X', ...) for the same event type X.
 */
function checkListenerLeak(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const added = new Map(); // eventType → [{ line, col }]
	const removed = new Set();
	const addPattern = /addEventListener\s*\(\s*['"]([^'"]+)['"]/g;
	const removePattern = /removeEventListener\s*\(\s*['"]([^'"]+)['"]/g;
	lines.forEach((line, idx) => {
		for (const m of line.matchAll(addPattern)) {
			const eventType = m[1];
			added.set(eventType, [...(added.get(eventType) ?? []), { line: idx + 1, col: m.index + 1 }]);
		}
		for (const m of line.matchAll(removePattern)) {
			removed.add(m[1]);
		}
	});
	for (const [eventType, occurrences] of added) {
		if (removed.has(eventType)) continue;
		for (const { line, col } of occurrences) {
			issues.push({
				rule: 'listener-leak',
				severity: 'warn',
				line,
				col,
				message: `addEventListener('${eventType}', ...) has no matching removeEventListener('${eventType}', ...)`,
			});
		}
	}
	return issues;
}

/**
 * Rule 4: ssrf-fetch
 *   - fetch(`http...`) / fetch(`...${var}...`) / fetch(url, endpoint, ...)
 *     without isPrivateHost() check within 5 lines above.
 *   - Skipped if the file imports isPrivateHost.
 */
function checkSsrfFetch(content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	if (importsSSRFGuard(content)) return issues;
	// Dynamic URL fetches: template-literal http, ${...}, or a variable/identifier.
	// Excludes: fetch('./foo'), fetch('/api'), fetch('data:...'), fetch(`./foo`).
	const pattern = /\bfetch\s*\(\s*(?:`[^`]*\$|`https?:|[$A-Za-z_][\w$]*)/;
	lines.forEach((line, idx) => {
		if (!pattern.test(line)) return;
		// Look backward 5 lines for isPrivateHost(
		let guarded = false;
		for (let i = Math.max(0, idx - 5); i < idx; i++) {
			if (/\bisPrivateHost\s*\(/.test(lines[i] ?? '')) {
				guarded = true;
				break;
			}
		}
		if (guarded) return;
		const col = line.search(pattern) + 1;
		issues.push({
			rule: 'ssrf-fetch',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'fetch() with dynamic URL — wrap with isPrivateHost(hostname) guard against SSRF',
		});
	});
	return issues;
}

/**
 * Rule 5: serialized-queue-broken-chain
 *   - Pattern `<var>.then(` where the chain doesn't include a `.catch()`
 *     anywhere before the statement terminator.
 */
function checkSerializedQueueBrokenChain(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const queueVarPattern = /\b(opQueue|queue|serializedQueue)\.then\s*\(/;
	lines.forEach((line, idx) => {
		if (!queueVarPattern.test(line)) return;
		// Scan forward up to 6 lines looking for `.catch(` before `;` or end of window.
		// If the chain ends (via `;`) or the window is exhausted without a `.catch`,
		// flag it so the AI can review.
		let foundCatch = false;
		for (let i = idx; i < Math.min(lines.length, idx + 6); i++) {
			const l = lines[i] ?? '';
			if (/\.catch\s*\(/.test(l)) {
				foundCatch = true;
				break;
			}
			// Statement terminator — chain ended without `.catch`.
			if (/;\s*$/.test(l)) break;
		}
		if (foundCatch) return;
		const col = line.search(queueVarPattern) + 1;
		issues.push({
			rule: 'serialized-queue-broken-chain',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'Serialized queue `.then()` chain lacks `.catch()` — a rejected op blocks all subsequent ops',
		});
	});
	return issues;
}

/**
 * Rule 6: onmessage-async-no-return
 *   - `chrome.runtime.onMessage.addListener(async ...)` whose body
 *     lacks `return true`.
 */
function checkOnMessageAsyncNoReturn(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const addListenerPattern = /chrome\.runtime\.onMessage\.addListener\s*\(\s*async\b/;
	lines.forEach((line, idx) => {
		if (!addListenerPattern.test(line)) return;
		// Find the closing `})` of the listener. Scan forward up to 80 lines.
		let depth = 0;
		let foundReturnTrue = false;
		for (let i = idx; i < Math.min(lines.length, idx + 80); i++) {
			const l = lines[i] ?? '';
			// Track braces to find the listener body end.
			for (const ch of l) {
				if (ch === '{') depth++;
				else if (ch === '}') {
					depth--;
					if (depth === 0) break;
				}
			}
			if (/return\s+true\b/.test(l)) foundReturnTrue = true;
			if (depth === 0) break;
		}
		if (!foundReturnTrue) {
			const col = line.search(addListenerPattern) + 1;
			issues.push({
				rule: 'onmessage-async-no-return',
				severity: 'error',
				line: idx + 1,
				col,
				message: 'async onMessage listener missing `return true` — async sendResponse will be lost',
			});
		}
	});
	return issues;
}

/**
 * Rule 7: deep-path-import
 *   - `from '@nexus/<pkg>/src/...'` — bypasses package exports.
 */
function checkDeepPathImport(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const pattern = /from\s+['"]@nexus\/[^'"]+\/src\//;
	lines.forEach((line, idx) => {
		if (!pattern.test(line)) return;
		const col = line.search(pattern) + 1;
		issues.push({
			rule: 'deep-path-import',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'Deep import into @nexus/<pkg>/src/ — use package root or subpath export',
		});
	});
	return issues;
}

/**
 * Rule 8: branded-type-reuse
 *   - Imports `TabId`, `VolumeLevel`, `DomainName` — branded types
 *     that were deleted from @nexus/contracts.
 */
function checkBrandedTypeReuse(_content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	const pattern = /\b(?:TabId|VolumeLevel|DomainName)\b/;
	lines.forEach((line, idx) => {
		if (!pattern.test(line)) return;
		// Only flag imports and type-position references; skip strings.
		if (/['"`].*\b(?:TabId|VolumeLevel|DomainName)\b.*['"`]/.test(line)) return;
		const col = line.search(pattern) + 1;
		issues.push({
			rule: 'branded-type-reuse',
			severity: 'error',
			line: idx + 1,
			col,
			message: 'Branded type (TabId/VolumeLevel/DomainName) was deleted — use number/string',
		});
	});
	return issues;
}

/**
 * Rule 9: missing-js-extension
 *   - Relative TS imports must end in .js (or .json/.css/.svg/.tsx/.ts).
 *   - Only .ts/.tsx files. Skip test files for .ts imports.
 */
function checkMissingJsExtension(filePath, _content, lines) {
	/** @type {Issue[]} */
	const issues = [];
	if (!/\.(ts|tsx)$/.test(filePath)) return issues;
	const isTest = /\.(spec|test)\.ts$/.test(filePath);
	const pattern = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
	lines.forEach((line, idx) => {
		// suppression on current line or previous line opts out.
		if (/\/\/\s*biome-ignore/.test(line)) return;
		const prevLine = lines[idx - 1] ?? '';
		if (/\/\/\s*biome-ignore/.test(prevLine)) return;
		for (const m of line.matchAll(pattern)) {
			const importPath = m[1];
			// Allow: .js, .json, .css, .svg, .tsx (anywhere), .ts (only in test files)
			if (/\.(js|json|css|svg|tsx)$/.test(importPath)) continue;
			if (isTest && /\.ts$/.test(importPath)) continue;
			if (/\.[a-z0-9]+$/i.test(importPath)) continue; // some other extension; skip
			const col = m.index + 1;
			issues.push({
				rule: 'missing-js-extension',
				severity: 'warn',
				line: idx + 1,
				col,
				message: `Relative import '${importPath}' missing .js extension (ESM requires explicit extension)`,
			});
		}
	});
	return issues;
}

/**
 * Scan a single file's content for all AI pitfall rules.
 *
 * @param {string} filePath — absolute or repo-relative path
 * @param {string} content — file content
 * @returns {Issue[]} — array of issues found (empty if none)
 */
export function scanFileContent(filePath, content) {
	/** @type {Issue[]} */
	const all = [];
	if (!content || typeof content !== 'string') return all;
	// Skip non-source files.
	if (!JS_EXT.test(filePath) && !filePath.endsWith('.js')) return all;
	// Skip generated/dist/node_modules paths.
	if (SKIP_DIRS.test(filePath)) return all;
	const lines = content.split(/\r?\n/);

	all.push(...checkStorageWriteUncaught(content, lines));
	all.push(...checkFetchUncaught(content, lines));
	all.push(...checkListenerLeak(content, lines));
	all.push(...checkSsrfFetch(content, lines));
	all.push(...checkSerializedQueueBrokenChain(content, lines));
	all.push(...checkOnMessageAsyncNoReturn(content, lines));
	all.push(...checkDeepPathImport(content, lines));
	all.push(...checkBrandedTypeReuse(content, lines));
	all.push(...checkMissingJsExtension(filePath, content, lines));

	// Stable sort by (line, col) for deterministic output.
	all.sort((a, b) => a.line - b.line || a.col - b.col);
	return all;
}

/**
 * Format an issue as a single-line string for display.
 *
 * @param {string} filePath
 * @param {Issue} issue
 * @returns {string}
 */
export function formatIssue(filePath, issue) {
	return `[ai-pitfall-detector] ${filePath}:${issue.line}:${issue.col} ${issue.severity.toUpperCase()} ${issue.rule}: ${issue.message}`;
}

/**
 * Run the scanner over a list of files. Returns the array of all issues.
 *
 * @param {string[]} files
 * @returns {Issue[]}
 */
export function scanFiles(files) {
	/** @type {Issue[]} */
	const all = [];
	for (const file of files) {
		if (!file || SKIP_DIRS.test(file)) continue;
		if (!JS_EXT.test(file)) continue;
		let content;
		try {
			content = readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		const issues = scanFileContent(file, content);
		for (const issue of issues) {
			all.push({ ...issue, message: formatIssue(file, issue) });
		}
	}
	return all;
}

/**
 * Default changed-files provider for CLI mode: uses `git diff --name-only`
 * on the most recent commit, filtered to nexus source files.
 * Returns an empty array when git is unavailable or no changes.
 *
 * @returns {string[]}
 */
function getChangedFiles() {
	try {
		const out = execSync('git diff --name-only HEAD~1 HEAD', {
			encoding: 'utf8',
			cwd: process.cwd(),
		});
		return out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && JS_EXT.test(l));
	} catch {
		return [];
	}
}

// ---------- CLI entry -------------------------------------------------

if (import.meta.main) {
	const args = process.argv.slice(2);
	const files = args.length > 0
		? args
		: getChangedFiles();

	if (files.length === 0) {
		console.log('[ai-pitfall-detector] no files to scan');
		process.exit(0);
	}

	// Resolve file paths relative to CWD; join with repo root if needed.
	const resolved = files.map((f) => (f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f) ? f : join(process.cwd(), f)));

	/** @type {Issue[]} */
	const allIssues = [];
	for (const file of resolved) {
		if (!JS_EXT.test(file)) continue;
		if (SKIP_DIRS.test(file)) continue;
		let content;
		try {
			content = readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		const issues = scanFileContent(file, content);
		for (const issue of issues) {
			allIssues.push(issue);
			console.log(formatIssue(file, issue));
		}
	}

	const errors = allIssues.filter((i) => i.severity === 'error');
	const warns = allIssues.filter((i) => i.severity === 'warn');

	console.log(
		`\n[ai-pitfall-detector] ${files.length} file(s) scanned: ` +
		`${errors.length} error(s), ${warns.length} warning(s)`,
	);

	if (errors.length > 0) {
		process.exit(1);
	}
	process.exit(0);
}
