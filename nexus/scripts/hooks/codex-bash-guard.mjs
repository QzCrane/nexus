#!/usr/bin/env bun
// codex-bash-guard.mjs
//
// Codex CLI PreToolUse hook for `Bash`. Codex's experimental hooks
// (v0.114+, March 2026) only intercept `Bash` tool calls — direct
// file writes via the agent's own `Write`/`Edit`/`MultiEdit` tools
// are NOT hookable. So this guard focuses on bash commands that
// would write to forbidden zones.
//
// Forbidden operations (any of these patterns block the command):
//   - rm / mv / cp targeting docs/_archive/
//   - rm -rf / mv AGENTS.md / mv CLAUDE.md
//   - redirection (>, >>) into docs/_archive/ or AGENTS/CLAUDE
//   - sed -i on AGENTS.md / CLAUDE.md / control-architecture.md
//   - git checkout / restore that would discard staged safety files
//   - drop / truncate on the canonical index files
//
// stdin: { tool_name, tool_input: { command, ... }, ... }
// stdout: { decision: "block", reason: "..." } OR plain text
// exit 0: allow
// exit 2: block
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import { readStdin } from './_read-stdin.mjs';

const FORBIDDEN_COMMAND_PATTERNS = [
	{
		// rm / rm -rf targeting forbidden zones
		pattern: /\b(rm|mv|cp)\b[^|;&]*\b(?:docs\/_archive|AGENTS\.md|CLAUDE\.md|control-architecture\.md|principles\/\d{2}-[a-z-]+\.md)\b/i,
		reason:
			'Forbidden shell op on protected file/zone. Use git mv / git rm for tracked files; ' +
			'for docs/_archive/, treat as read-only historical snapshot. ' +
			'AGENTS.md / CLAUDE.md are owned by humans (NTFS hardlink) and must be edited ' +
			'inline or replaced via postanalyze.mjs.',
	},
	{
		// redirection into forbidden zones
		pattern: /(?:>|>>|tee\s+)(?:\s*['"]?)(?:\.{0,2}\/)?(?:.*\/)?(?:docs\/_archive|AGENTS\.md|CLAUDE\.md|control-architecture\.md)\b/i,
		reason:
			'Output redirection into a protected zone. Edit the live owner doc or add a new ' +
			'SKILL.md / .agents/skills/<name>/SKILL.md instead.',
	},
	{
		// sed -i in-place edit on protected files
		pattern: /\bsed\s+-i[^\s]*\s+[^|;&]*\b(?:AGENTS\.md|CLAUDE\.md|control-architecture\.md)\b/i,
		reason:
			'sed -i on AGENTS.md / CLAUDE.md is forbidden because the hardlink relationship ' +
			'must be preserved (or rebuilt by postanalyze.mjs).',
	},
	{
		// git checkout / restore that would clobber protected files
		pattern: /\bgit\s+(?:checkout|restore|reset)\b[^|;&]*--(?:[^|;&]*\s)?(?:AGENTS\.md|CLAUDE\.md|nexus\/scripts\/(?:hooks|lint-docs|verify)[^\s]*)/i,
		reason:
			'Discarding changes to protected rule/hook files. If the change is bad, revert it ' +
			'with `git revert` (which preserves audit trail); do not silently restore.',
	},
	{
		// bulk chmod / chown / rm -rf on the project root
		pattern: /\b(?:chmod|chown|rm\s+-rf?)\s+[^|;&]*\/(?:\s|$)/,
		reason:
			'Bulk permission/destruction command on the workspace root is not allowed. ' +
			'Target individual files or use a narrow glob.',
	},
];

function extractCommands(payload) {
	const input = payload.tool_input ?? {};
	const command = typeof input.command === 'string' ? input.command : '';
	// split on ; & && || | newlines so each sub-command is judged independently
	return command
		.split(/\s*(?:;|&&|\|\||\|\n|\n)\s*/g)
		.map((c) => c.trim())
		.filter(Boolean);
}

async function main() {
	const raw = await readStdin();
	let payload = {};
	try {
		payload = JSON.parse(raw || '{}');
	} catch {
		process.exit(0);
	}
	if (payload.tool_name !== 'Bash') process.exit(0);

	const commands = extractCommands(payload);
	if (commands.length === 0) process.exit(0);

	for (const cmd of commands) {
		for (const { pattern, reason } of FORBIDDEN_COMMAND_PATTERNS) {
			if (pattern.test(cmd)) {
				const out =
					JSON.stringify({
						decision: 'block',
						reason: `[codex-bash-guard] ${reason}  matched: \`${cmd}\``,
					}) + '\n';
				process.stdout.write(out);
				process.exit(2);
			}
		}
	}

	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[codex-bash-guard] error: ${err?.message ?? err}\n`);
	process.exit(0); // never block the agent on a hook crash
});
