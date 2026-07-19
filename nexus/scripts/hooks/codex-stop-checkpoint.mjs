#!/usr/bin/env bun
// codex-stop-checkpoint.mjs
//
// Codex CLI Stop hook. Fires when the agent turn ends (equivalent
// of Claude Code's Stop hook). Surfaces a short reminder of what
// to run before declaring done. The message itself lives in
// `_hook-helpers.formatCheckpointMessage` so the AI-stop and
// codex-stop reminders stay in lockstep.
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { formatCheckpointMessage, runHook } from './_hook-helpers.mjs';

async function main() {
	process.stdout.write(formatCheckpointMessage('codex-stop-checkpoint'));
}

// Only run the hook when invoked directly (not when imported by the
// test runner). Bun sets `import.meta.main` to true for the entry
// script; imported modules see `false`.
if (import.meta.main) {
	await runHook('codex-stop-checkpoint', main);
}
