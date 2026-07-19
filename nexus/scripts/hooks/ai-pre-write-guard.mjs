#!/usr/bin/env bun
// ai-pre-write-guard.mjs
//
// Claude Code / Antigravity PreToolUse hook for Write|Edit|MultiEdit.
// Blocks AI from writing into forbidden zones. Exit code 2 = block.
//
// Forbidden zones:
//   1. docs/_archive/         historical snapshots; must not be edited
//   2. AGENTS.md / CLAUDE.md  root rule files; managed by humans + postanalyze
//   3. control-architecture.md / control/<NN>-*.md / principles/<NN>-*.md
//                             progressive-disclosure index files; humans
//                             own them; the topic sub-files are the owner
//   4. any .md without Diátaxis frontmatter (type / status / audience)
//
// Rule owner: AGENTS.md EPR-029 (硬化质量门到 Git/CI/AI 钩子)

import {
	blockMessage,
	extractWriteTargets,
	relPath,
	runHook,
	WRITE_TOOLS,
} from './_hook-helpers.mjs';

const FORBIDDEN_PATTERNS = [
	{
		pattern: /(^|\/)docs\/_archive\//,
		reason:
			'docs/_archive/ is a read-only historical snapshot. ' +
			'Edit the live owner doc instead and link the archive.',
	},
	{
		pattern: /(^|\/)(AGENTS|CLAUDE)\.md$/,
		reason:
			'AGENTS.md and CLAUDE.md are owned by humans and synced via ' +
			'postanalyze.mjs (NTFS hardlink). Edit rules inline or ' +
			'add a new SKILL.md / .agents/skills/<name>/SKILL.md.',
	},
	{
		pattern:
			/control-architecture\.md$|control\/\d{2}-[a-z-]+\.md$|principles\/0[1-5]-[a-z-]+\.md$/,
		reason:
			'This is a progressive-disclosure index or a topic sub-file. ' +
			'Indexes hold ONLY the topic map + summary table; topic files ' +
			'hold the normative content. Do not duplicate rules between them.',
	},
];

const FRONTMATTER_TYPE = /(explanation|tutorial|how-to|reference)/;
const FRONTMATTER_STATUS = /(stable|draft|deprecated)/;

function frontmatterProblem(filePath, content) {
	if (!filePath.endsWith('.md')) return null;
	if (filePath.endsWith('CHANGELOG.md')) return null;
	if (!content) return null;
	const head = content.slice(0, 600);
	if (!head.startsWith('---')) return 'missing frontmatter delimiter `---`';
	const end = head.indexOf('---', 3);
	if (end < 0) return 'unterminated frontmatter block';
	const block = head.slice(3, end);
	if (!/type:\s*/.test(block) || !FRONTMATTER_TYPE.test(block))
		return 'frontmatter missing `type` (explanation/tutorial/how-to/reference)';
	if (!/status:\s*/.test(block) || !FRONTMATTER_STATUS.test(block))
		return 'frontmatter missing `status` (stable/draft/deprecated)';
	if (!/audience:\s*\S+/.test(block)) return 'frontmatter missing `audience`';
	return null;
}

function matchForbidden(rel) {
	for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
		if (pattern.test(rel)) return reason;
	}
	return null;
}

await runHook('ai-pre-write-guard', async (payload) => {
	const tool = payload.tool_name ?? '';
	if (!WRITE_TOOLS.has(tool)) return; // allow non-write tools

	const targets = extractWriteTargets(payload);
	if (targets.length === 0) return; // nothing to check

	for (const filePath of targets) {
		const rel = relPath(filePath);
		const reason = matchForbidden(rel);
		if (reason) {
			blockMessage({ reason, target: rel, tool, rule: 'EPR-029' });
			process.exit(2);
		}
	}

	// Frontmatter check applies to Write only: Edit replaces a slice
	// and the agent typically keeps the existing head intact.
	if (tool === 'Write' || tool === 'write') {
		const filePath = targets[0];
		const content = payload?.tool_input?.content ?? '';
		const reason = frontmatterProblem(filePath, content);
		if (reason) {
			blockMessage({
				reason,
				target: relPath(filePath),
				tool,
				rule: 'Diátaxis frontmatter (type/status/audience) required',
			});
			process.exit(2);
		}
	}
});
