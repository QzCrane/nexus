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

import { spawnSync } from 'node:child_process';
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
 */
export function readStdin() {
	return new Promise((resolve) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => (data += c));
		process.stdin.on('end', () => resolve(data));
	});
}

/**
 * Safe JSON.parse with empty-object fallback. Never throws.
 */
export function parsePayload(raw) {
	if (!raw) return {};
	try {
		const obj = JSON.parse(raw);
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
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
 * Print a uniform BLOCKED log line. Returns nothing; just writes to
 * stdout (which is what Claude Code / Codex display in the chat).
 *
 *   `reason`  — short, single-line human explanation
 *   `target`  — file path or command that was blocked
 *   `tool`    — tool name (Write, Edit, Bash, ...)
 *   `rule`    — optional rule identifier (e.g. "EPR-029")
 */
export function blockMessage({ reason, target, tool, rule }) {
	const lines = [
		`[hook] BLOCKED ${target}`,
		`  reason: ${reason}`,
		tool ? `  tool:   ${tool}` : null,
		rule ? `  rule:   ${rule}` : null,
	].filter(Boolean);
	process.stdout.write(`${lines.join('\n')}\n`);
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
 */
export async function runHook(name, handler) {
	let payload = {};
	try {
		payload = parsePayload(await readStdin());
	} catch {
		process.exit(0);
	}
	try {
		await handler(payload);
	} catch (err) {
		process.stderr.write(`[${name}] error: ${err?.message ?? err}\n`);
		process.exit(0);
	}
	// If the handler didn't already exit, default to allow.
	process.exit(0);
}
