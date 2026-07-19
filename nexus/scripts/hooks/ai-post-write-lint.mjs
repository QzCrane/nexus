#!/usr/bin/env bun
// ai-post-write-lint.mjs
//
// Claude Code / Antigravity PostToolUse hook for Write|Edit|MultiEdit.
// Runs biome format on JS/TS and lint-docs on changed .md. Non-blocking:
// warnings are surfaced in chat; the agent decides whether to fix.
//
// Rule owner: AGENTS.md EPR-029 (质量门硬化到 Git/CI/AI 钩子)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './_read-stdin.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const cwd = process.cwd();
const base = (p) => normalize(relative(root, join(cwd, p))).split(sep).join('/');

function run(cmd, args) {
	const result = spawnSync(cmd, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return result;
}

async function main() {
	const raw = await readStdin();
	let payload = {};
	try {
		payload = JSON.parse(raw || '{}');
	} catch {
		process.exit(0);
	}
	const tool = payload.tool_name ?? '';
	if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);
	const input = payload.tool_input ?? {};
	const candidates = [];
	if (typeof input.file_path === 'string') candidates.push(input.file_path);
	if (Array.isArray(input.edits)) {
		for (const edit of input.edits) {
			if (edit?.file_path) candidates.push(edit.file_path);
		}
	}
	if (candidates.length === 0) process.exit(0);

	const mdFiles = [];
	const jsFiles = [];
	for (const filePath of candidates) {
		const abs = join(cwd, filePath);
		if (!existsSync(abs)) continue;
		if (filePath.endsWith('.md')) mdFiles.push(filePath);
		else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) jsFiles.push(filePath);
	}

	const warnings = [];

	if (mdFiles.length > 0) {
		const lintArgs = ['--cwd', 'nexus', 'scripts', 'lint-docs.mjs', ...mdFiles];
		const r = run('bun', lintArgs);
		if (r.status !== 0) {
			warnings.push(
				`[lint-docs] ${mdFiles.map(base).join(', ')} failed:\n` +
					(r.stdout || r.stderr || '').trim(),
			);
		}
	}

	if (jsFiles.length > 0) {
		const fmtArgs = [
			'@biomejs/biome',
			'format',
			'--write',
			'--no-errors-on-unmatched',
			...jsFiles,
		];
		const r = run('bunx', fmtArgs);
		if (r.status !== 0) {
			warnings.push(
				`[biome format] ${jsFiles.map(base).join(', ')} failed:\n` +
					(r.stdout || r.stderr || '').trim(),
			);
		} else {
			// biome format --write may rewrite files; report the change
			const note = (r.stdout || '').trim();
			if (note) warnings.push(`[biome format] reformatted: ${note}`);
		}
	}

	if (warnings.length > 0) {
		process.stdout.write(`[ai-post-write-lint]\n${warnings.join('\n\n')}\n`);
	}
	// Always exit 0: PostToolUse is informational, not blocking.
	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[ai-post-write-lint] error: ${err?.message ?? err}\n`);
	process.exit(0);
});
