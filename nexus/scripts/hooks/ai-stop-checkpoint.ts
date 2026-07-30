#!/usr/bin/env bun
// ai-stop-checkpoint.ts
//
// Antigravity Stop hook. Fires when the AI turn ends.
// Surfaces a short reminder of what to run before declaring done.
// The message itself lives in `_hook-helpers.formatCheckpointMessage`
// so the AI-stop and codex-stop reminders stay in lockstep.
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { formatCheckpointMessage, runHook } from './_hook-helpers.ts';

async function main() {
	process.stdout.write(formatCheckpointMessage('ai-stop-checkpoint'));
}

// Only run the hook when invoked directly (not when imported by the
// test runner). Bun sets `import.meta.main` to true for the entry
// script; imported modules see `false`.
if (import.meta.main) {
	await runHook('ai-stop-checkpoint', main);
}