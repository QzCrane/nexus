#!/usr/bin/env bun
// codex-bash-guard.mjs
//
// Codex CLI PreToolUse hook for `Bash`. Codex's experimental hooks
// (v0.114+, March 2026) only intercept `Bash` tool calls — direct file
// writes via the agent's own `Write`/`Edit`/`MultiEdit` tools are NOT
// hookable. So this guard focuses on bash commands that would write
// to forbidden zones.
//
// Forbidden operations (any match blocks the command):
//   - rm / mv / cp targeting docs/_archive/, AGENTS.md, CLAUDE.md,
//     control-architecture.md, control/NN-*.md, principles/NN-*.md
//   - redirection (>, >>) into any of the above
//   - sed -i on AGENTS.md / CLAUDE.md / control-architecture.md
//   - git checkout / restore / reset that would clobber safety files
//   - bulk chmod / chown / rm -rf on the workspace root
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import {
	blockMessage,
	extractBashCommand,
	runHook,
} from './_hook-helpers.mjs';

const PROTECTED_BASENAME =
	'(?:docs\\/_archive|AGENTS\\.md|CLAUDE\\.md|control-architecture\\.md|control\\/\\d{2}-[a-z-]+\\.md|principles\\/0[1-5]-[a-z-]+\\.md)';

const FORBIDDEN_PATTERNS = [
	{
		// rm / mv / cp targeting forbidden zones (separated by shell metachars)
		pattern: new RegExp(
			`\\b(?:rm|mv|cp)\\b[^|;&]*\\b${PROTECTED_BASENAME}\\b`,
			'i',
		),
		reason:
			'Forbidden shell op on protected file/zone. Use git mv / git rm for tracked files; ' +
			'for docs/_archive/, treat as read-only historical snapshot. ' +
			'AGENTS.md / CLAUDE.md are owned by humans (NTFS hardlink) and must be edited ' +
			'inline or replaced via postanalyze.mjs.',
	},
	{
		// redirection into forbidden zones
		pattern: new RegExp(
			`(?:>|>>|tee\\s+)(?:\\s*['"]?)(?:\\.{0,2}/)?(?:.*/)?${PROTECTED_BASENAME}\\b`,
			'i',
		),
		reason:
			'Output redirection into a protected zone. Edit the live owner doc or add a new ' +
			'SKILL.md / .agents/skills/<name>/SKILL.md instead.',
	},
	{
		// sed -i in-place edit on protected files
		pattern: new RegExp(
			`\\bsed\\s+-i[^\\s]*\\s+[^|;&]*\\b(?:AGENTS\\.md|CLAUDE\\.md|control-architecture\\.md)\\b`,
			'i',
		),
		reason:
			'sed -i on AGENTS.md / CLAUDE.md is forbidden because the hardlink relationship ' +
			'must be preserved (or rebuilt by postanalyze.mjs).',
	},
	{
		// git checkout / restore / reset that clobbers staged safety files
		pattern:
			/\bgit\s+(?:checkout|restore|reset)\b[^|;&]*--(?:[^|;&]*\s)?(?:AGENTS\.md|CLAUDE\.md|nexus\/scripts\/(?:hooks|lint-docs|verify)[^\s]*)/i,
		reason:
			'Discarding changes to protected rule/hook files. If the change is bad, revert it ' +
			'with `git revert` (which preserves audit trail); do not silently restore.',
	},
	{
		// bulk chmod / chown / rm -rf on the workspace root
		pattern: /\b(?:chmod|chown|rm\s+-rf?)\s+[^|;&]*\/(?:\s|$)/,
		reason:
			'Bulk permission/destruction command on the workspace root is not allowed. ' +
			'Target individual files or use a narrow glob.',
	},
];

/**
 * Split a shell command on its metacharacters so each sub-command
 * is judged independently. Catches `cd / && rm -rf AGENTS.md` style
 * smuggling.
 */
function splitCommands(command) {
	return command
		.split(/\s*(?:;|&&|\|\||\|\n|\n)\s*/g)
		.map((c) => c.trim())
		.filter(Boolean);
}

await runHook('codex-bash-guard', async (payload) => {
	const tool = payload.tool_name ?? '';
	if (tool !== 'Bash') return;

	const command = extractBashCommand(payload);
	if (!command) return;

	for (const sub of splitCommands(command)) {
		for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
			if (pattern.test(sub)) {
				blockMessage({
					reason,
					target: `\`${sub}\``,
					tool,
					rule: 'EPR-029',
				});
				process.exit(2);
			}
		}
	}
});
