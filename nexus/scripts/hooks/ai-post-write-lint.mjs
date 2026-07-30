#!/usr/bin/env bun
// ai-post-write-lint.mjs
//
// Claude Code / Antigravity PostToolUse hook for Write|Edit|MultiEdit.
// Runs the repository's strict Biome owner on JS/TS and lint-docs on
// changed .md. The hook never rewrites files. It is non-blocking:
// diagnostics are surfaced in chat; the agent decides whether to fix.
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	extractWriteTargets,
	relPath,
	run,
	runHook,
	WRITE_TOOLS,
} from './_hook-helpers.mjs';
import { scanFileContent, formatIssue } from './ai-pitfall-detector.mjs';

const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const workspaceDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repositoryDir = dirname(workspaceDir);

function strictLintTargets(paths, cwd = process.cwd()) {
	return paths.flatMap((path) => {
		const absolute = resolve(cwd, path);
		const repositoryRelative = relative(repositoryDir, absolute);
		if (
			!repositoryRelative ||
			isAbsolute(repositoryRelative) ||
			repositoryRelative === '..' ||
			repositoryRelative.startsWith(`..${sep}`)
		) {
			return [];
		}
		return [relative(workspaceDir, absolute).replaceAll('\\', '/')];
	});
}

async function main(payload) {
	const tool = payload.tool_name ?? '';
	if (!WRITE_TOOLS.has(tool)) return;

	const targets = extractWriteTargets(payload);
	if (targets.length === 0) return;

	const mdFiles = [];
	const jsFiles = [];
	for (const p of targets) {
		const abs = resolve(process.cwd(), p);
		if (!existsSync(abs)) continue;
		if (p.endsWith('.md')) mdFiles.push(p);
		else if (JS_EXT.test(p)) jsFiles.push(p);
	}

	const warnings = [];

	if (mdFiles.length > 0) {
		const r = run(process.execPath, ['--cwd', 'nexus', 'scripts', 'lint-docs.mjs', ...mdFiles]);
		if (r.status !== 0) {
			warnings.push(
				`[lint-docs] ${mdFiles.map(relPath).join(', ')} failed:\n` +
					(r.stdout || r.stderr || '').trim(),
			);
		}
	}

	if (jsFiles.length > 0) {
		const lintTargets = strictLintTargets(jsFiles);
		if (lintTargets.length > 0) {
			const r = run(
				process.execPath,
				['scripts/run-strict-biome.mjs', ...lintTargets],
				{ cwd: workspaceDir },
			);
			if (r.status !== 0) {
				warnings.push(
					`[strict-biome] ${jsFiles.map(relPath).join(', ')} failed:\n` +
						(r.stdout || r.stderr || '').trim(),
				);
			}
		}

		// Static heuristic scan for common AI authoring pitfalls.
		// Non-blocking: surfaces issues back to the AI so it can decide
		// whether to fix. Errors would still be caught by lefthook
		// pre-push (lint:ai-pitfalls).
		for (const p of jsFiles) {
			const abs = resolve(process.cwd(), p);
			let content;
			try {
				content = readFileSync(abs, 'utf8');
			} catch {
				continue;
			}
			const issues = scanFileContent(abs, content);
			if (issues.length === 0) continue;
			const block = issues
				.map((issue) => `  ${formatIssue(relPath(p), issue)}`)
				.join('\n');
			warnings.push(`[ai-pitfall-detector]\n${block}`);
		}
	}

	if (warnings.length > 0) {
		process.stdout.write(`[ai-post-write-lint]\n${warnings.join('\n\n')}\n`);
	}
	// PostToolUse is informational, never blocking.
}

// Only run the hook when invoked directly (not when imported by the
// test runner). Bun sets `import.meta.main` to true for the entry
// script; imported modules see `false`.
if (import.meta.main) {
	await runHook('ai-post-write-lint', main);
}

export { strictLintTargets };
