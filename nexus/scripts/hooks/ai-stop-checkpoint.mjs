#!/usr/bin/env bun
// ai-stop-checkpoint.mjs
//
// Claude Code / Antigravity Stop hook. Fires when the AI turn ends.
// Surfaces a short reminder of what to run before declaring done.
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { execSync } from 'node:child_process';
import { runHook } from './_hook-helpers.mjs';

function shortGitStatus() {
	try {
		const out = execSync('git status --short', { encoding: 'utf8' });
		const lines = out.split('\n').filter(Boolean);
		return { dirty: lines.length > 0, count: lines.length };
	} catch {
		return { dirty: null, count: 0 };
	}
}

await runHook('ai-stop-checkpoint', async () => {
	const status = shortGitStatus();
	const lines = ['[ai-stop-checkpoint] turn ending.'];
	if (status.dirty) {
		lines.push(
			`  working tree: ${status.count} modified/new file(s). ` +
				'lefthook pre-commit will run `lint-docs` + `biome check`; ' +
				'pre-push will run `verify:q`.',
		);
	} else {
		lines.push(
			'  working tree clean. if you did not commit, consider ' +
				'`bun run verify:q` to confirm the architecture gate is still green.',
		);
	}
	lines.push(
		'  rule of thumb: each closed-loop commit = contract + impl + test + doc.',
	);
	process.stdout.write(`${lines.join('\n')}\n`);
});
