#!/usr/bin/env bun
// codex-stop-checkpoint.mjs
//
// Codex CLI Stop hook. Fires when the agent turn ends (equivalent
// of Claude Code's Stop hook). Surfaces a short reminder of what
// to run before declaring done.
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { execSync } from 'node:child_process';
import { readStdin } from './_read-stdin.mjs';

function shortGitStatus() {
	try {
		const out = execSync('git status --short', { encoding: 'utf8' });
		const lines = out.split('\n').filter(Boolean);
		return { dirty: lines.length > 0, count: lines.length };
	} catch {
		return { dirty: null, count: 0 };
	}
}

async function main() {
	await readStdin(); // drain
	const status = shortGitStatus();
	const lines = [];
	lines.push('[codex-stop-checkpoint] turn ending.');
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
	process.exit(0);
}

main().catch(() => process.exit(0));
