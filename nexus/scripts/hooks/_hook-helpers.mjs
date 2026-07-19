#!/usr/bin/env bun
// _hook-helpers.mjs
//
// Shared utilities for every AI-tool hook script under
// nexus/scripts/hooks/. All hook scripts are expected to import
// from here instead of re-implementing:
//
//   - readStdin()              drain the host's stdin payload
//   - parsePayload()           safe JSON.parse with empty fallback
//   - extractWriteTargets()    pull file_path from Write/Edit/MultiEdit
//   - extractBashCommand()     pull `command` from Bash (Codex)
//   - relPath()                normalize to repo-relative POSIX path
//   - blockMessage()           format a BLOCKED log line for the host
//   - runHook()                standard entry point with consistent
//                              error handling (always exit 0 on crash
//                              so a broken hook never freezes the agent)
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { execSync, spawnSync } from 'node:child_process';
import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- path resolution (memoized) --------------------------------

const __filename = fileURLToPath(import.meta.url);
// this file lives at nexus/scripts/hooks/_hook-helpers.mjs → repo root is 3 up
const REPO_ROOT = normalize(join(__filename, '..', '..', '..'));
const CWD = process.cwd();

/**
 * Normalize a path (absolute or CWD-relative) to a repo-relative POSIX
 * path. Returns the input unchanged if it is not inside the repo.
 */
export function relPath(p) {
	if (typeof p !== 'string' || p.length === 0) return '';
	const abs = p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) ? p : join(CWD, p);
	const r = relative(REPO_ROOT, abs);
	if (r.startsWith('..')) return r.split(sep).join('/');
	return r.split(sep).join('/');
}

// ---------- stdin / payload parsing -----------------------------------

/**
 * Read the host's stdin until EOF. Always resolves; never rejects.
 *
 * If `NEXUS_HOOK_DEBUG=1` is set in the environment, the raw payload
 * is also tee'd to stderr prefixed with `[hook-debug]` so you can
 * inspect what the host actually sent:
 *
 *   NEXUS_HOOK_DEBUG=1 bun --cwd nexus scripts/hooks/ai-pre-write-guard.mjs
 */
export function readStdin() {
	return new Promise((resolve) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => {
			data += c;
			// biome-ignore lint/suspicious/noUndeclaredEnvVars: debug-only env var, intentionally not in turbo.json
			if (process.env.NEXUS_HOOK_DEBUG === '1') {
				process.stderr.write(`[hook-debug] stdin chunk (${c.length} bytes):\n${c}\n`);
			}
		});
		process.stdin.on('end', () => {
			// biome-ignore lint/suspicious/noUndeclaredEnvVars: debug-only env var, intentionally not in turbo.json
			if (process.env.NEXUS_HOOK_DEBUG === '1') {
				process.stderr.write(`[hook-debug] stdin total ${data.length} bytes\n`);
			}
			resolve(data);
		});
	});
}

/**
 * Safe JSON.parse with empty-object fallback. Never throws.
 *
 * Returns `{}` for any non-object input (arrays, primitives, null)
 * because hook handlers expect a payload object shape.
 */
export function parsePayload(raw) {
	if (!raw) return {};
	let obj;
	try {
		obj = JSON.parse(raw);
	} catch {
		return {};
	}
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
		return {};
	}
	return obj;
}

// ---------- tool-call extractors --------------------------------------

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'write', 'edit', 'multi_edit']);

export { WRITE_TOOLS };

/**
 * Pull every candidate file path from a Write/Edit/MultiEdit payload.
 * Edit / MultiEdit carry their targets inside `tool_input.edits[]`;
 * Write carries the single path on `tool_input.file_path`. Returns
 * an array (possibly empty) of raw path strings as the host sent them.
 */
export function extractWriteTargets(payload) {
	const input = payload?.tool_input ?? {};
	const out = [];
	if (typeof input.file_path === 'string') out.push(input.file_path);
	if (Array.isArray(input.edits)) {
		for (const e of input.edits) {
			if (e && typeof e.file_path === 'string') out.push(e.file_path);
		}
	}
	return out;
}

/**
 * Pull the bash command string from a Codex Bash payload. Returns
 * the empty string if the payload is not a Bash tool call.
 */
export function extractBashCommand(payload) {
	if (payload?.tool_name !== 'Bash') return '';
	const cmd = payload?.tool_input?.command;
	return typeof cmd === 'string' ? cmd : '';
}

// ---------- output formatting ----------------------------------------

/**
 * Format a uniform BLOCKED log line as a string (no I/O). Factored
 * out of `blockMessage` so the test runner can assert the exact text
 * without capturing stdout.
 *
 *   `reason`  — short, single-line human explanation
 *   `target`  — file path or command that was blocked
 *   `tool`    — tool name (Write, Edit, Bash, ...)
 *   `rule`    — optional rule identifier (e.g. "EPR-029")
 */
export function formatBlockMessage({ reason, target, tool, rule }) {
	const lines = [
		`[hook] BLOCKED ${target}`,
		`  reason: ${reason}`,
		tool ? `  tool:   ${tool}` : null,
		rule ? `  rule:   ${rule}` : null,
	].filter(Boolean);
	return `${lines.join('\n')}\n`;
}

/**
 * Print a uniform BLOCKED log line. Returns nothing; just writes to
 * stdout (which is what Claude Code / Codex display in the chat).
 *
 *   `reason`  — short, single-line human explanation
 *   `target`  — file path or command that was blocked
 *   `tool`    — tool name (Write, Edit, Bash, ...)
 *   `rule`    — optional rule identifier (e.g. "EPR-029")
 */
export function blockMessage(opts) {
	process.stdout.write(formatBlockMessage(opts));
}

// ---------- checkpoint formatting (Stop hooks) ------------------------

/**
 * Read `git status --short` and summarize the count. Never throws.
 * Returns `{ dirty: boolean|null, count: number }` where `dirty` is
 * null when git is unavailable (e.g., not a git repo / git missing
 * from PATH).
 */
export function gitStatusShort() {
	try {
		const out = execSync('git status --short', { encoding: 'utf8' });
		const lines = out.split('\n').filter(Boolean);
		return { dirty: lines.length > 0, count: lines.length };
	} catch {
		return { dirty: null, count: 0 };
	}
}

/**
 * Render the Stop-hook reminder shown at the end of an AI turn. The
 * `name` parameter is the hook label printed at the top of the block
 * (e.g. "ai-stop-checkpoint" or "codex-stop-checkpoint"). Shared by
 * every AI-tool Stop hook so the message stays in lockstep across
 * Claude Code / Antigravity / Codex CLI.
 */
export function formatCheckpointMessage(name) {
	const status = gitStatusShort();
	const lines = [`[${name}] turn ending.`];
	if (status.dirty) {
		lines.push(
			`  working tree: ${status.count} modified/new file(s). ` +
				'lefthook pre-commit will run `lint-docs` + `biome check`; ' +
				'pre-push will run `verify:q`.',
		);
	} else if (status.dirty === false) {
		lines.push(
			'  working tree clean. if you did not commit, consider ' +
				'`bun run verify:q` to confirm the architecture gate is still green.',
		);
	}
	// When status.dirty === null (git unavailable), skip the tree line
	// but still print the rule-of-thumb reminder below.
	lines.push(
		'  rule of thumb: each closed-loop commit = contract + impl + test + doc.',
	);
	return `${lines.join('\n')}\n`;
}

// ---------- child-process runner --------------------------------------

/**
 * Synchronous child-process runner. Always returns a result object
 * (never throws). Caller can check `status`, `stdout`, `stderr`.
 */
export function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, {
		cwd: opts.cwd ?? CWD,
		encoding: 'utf8',
		stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
		...opts,
	});
}

// ---------- standard entry point --------------------------------------

/**
 * Wrap a hook's main logic with consistent error handling. The handler
 * receives a parsed payload and decides what to do; it may call
 * process.exit(0) to allow, process.exit(2) to block, or just return
 * to allow. On uncaught error we log to stderr and exit 0 — a broken
 * hook must never freeze the agent.
 *
 * When `NEXUS_HOOK_DEBUG=1`, the parsed payload and final exit code
 * are logged to stderr so you can trace the decision flow:
 *
 *   NEXUS_HOOK_DEBUG=1 bun --cwd nexus scripts/hooks/ai-pre-write-guard.mjs
 */
export async function runHook(name, handler) {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: debug-only env var, intentionally not in turbo.json
	const debug = process.env.NEXUS_HOOK_DEBUG === '1';
	let payload = {};
	try {
		payload = parsePayload(await readStdin());
	} catch {
		if (debug) process.stderr.write(`[${name}] stdin parse failed; allowing\n`);
		process.exit(0);
	}
	if (debug) {
		process.stderr.write(`[${name}] parsed payload: ${JSON.stringify(payload)}\n`);
	}
	try {
		await handler(payload);
	} catch (err) {
		process.stderr.write(`[${name}] error: ${err?.message ?? err}\n`);
		process.exit(0);
	}
	if (debug) process.stderr.write(`[${name}] handler returned without exit; allowing\n`);
	// If the handler didn't already exit, default to allow.
	process.exit(0);
}
