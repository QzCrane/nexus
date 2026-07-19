#!/usr/bin/env bun
// ai-pre-write-guard.mjs
//
// Claude Code / Antigravity PreToolUse hook for Write|Edit|MultiEdit.
// Blocks AI from writing into forbidden zones. Exit code 2 = block.
//
// Forbidden zones:
//   1. docs/_archive/         historical snapshots; must not be edited
//   2. AGENTS.md / CLAUDE.md  root rule files; managed by humans + postanalyze
//   3. control-architecture.md  / control/*-index.md  // index files; humans own
//      them; the topic sub-files are the actual owner
//   4. any .md without Diátaxis frontmatter (type / status / audience)
//
// stdin: { tool_name, tool_input:{file_path, content}, ... }
// stdout: human-readable reason (Claude shows it to the user)
// exit 0: allow
// exit 2: block
//
// Rule owner: AGENTS.md EPR-029 (质量门硬化到 Git/CI/AI 钩子)

import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const cwd = process.cwd();
const base = (p) => normalize(relative(root, join(cwd, p))).split(sep).join('/');

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
			'Indexes hold ONLY the topic map + summary table; topic files hold ' +
			'the normative content. Do not put detailed rules in indexes, ' +
			'and do not duplicate content between index and sub-file.',
	},
];

function readStdin() {
	return new Promise((resolve) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => (data += c));
		process.stdin.on('end', () => resolve(data));
	});
}

function fileNeedsFrontmatter(filePath, content) {
	if (!filePath.endsWith('.md')) return null;
	if (filePath.endsWith('CHANGELOG.md')) return null;
	if (!content) return null;
	const head = content.slice(0, 600);
	if (!head.startsWith('---')) return 'missing frontmatter delimiter `---`';
	const end = head.indexOf('---', 3);
	if (end < 0) return 'unterminated frontmatter block';
	const block = head.slice(3, end);
	if (!/type:\s*(explanation|tutorial|how-to|reference)/.test(block)) {
		return 'frontmatter missing `type` (explanation/tutorial/how-to/reference)';
	}
	if (!/status:\s*(stable|draft|deprecated)/.test(block)) {
		return 'frontmatter missing `status` (stable/draft/deprecated)';
	}
	if (!/audience:\s*\S+/.test(block)) {
		return 'frontmatter missing `audience`';
	}
	return null;
}

async function main() {
	const raw = await readStdin();
	let payload = {};
	try {
		payload = JSON.parse(raw || '{}');
	} catch {
		// tolerate non-JSON stdin
	}
	const tool = payload.tool_name ?? '';
	if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) {
		process.exit(0);
	}
	const input = payload.tool_input ?? {};
	const candidates = [];
	if (typeof input.file_path === 'string') candidates.push(input.file_path);
	if (Array.isArray(input.edits)) {
		for (const edit of input.edits) {
			if (edit?.file_path) candidates.push(edit.file_path);
		}
	}
	if (candidates.length === 0) process.exit(0);

	for (const filePath of candidates) {
		const rel = base(filePath);
		for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
			if (pattern.test(rel)) {
				process.stdout.write(
					`[ai-pre-write-guard] BLOCKED writing ${rel}\n` +
						`  reason: ${reason}\n` +
						`  tool:   ${tool}\n` +
						`  rule:   EPR-029 (engineering-principles.md)\n`,
				);
				process.exit(2);
			}
		}
	}

	// Frontmatter check applies to Write only (Edit replaces a slice, not the file head).
	if (tool === 'Write') {
		const filePath = candidates[0];
		const content = typeof input.content === 'string' ? input.content : '';
		const reason = fileNeedsFrontmatter(filePath, content);
		if (reason) {
			process.stdout.write(
				`[ai-pre-write-guard] BLOCKED writing ${base(filePath)}\n` +
					`  reason: ${reason}\n` +
					`  rule:   Diátaxis frontmatter (type/status/audience) required.\n`,
			);
			process.exit(2);
		}
	}

	process.exit(0);
}

main().catch((err) => {
	process.stderr.write(`[ai-pre-write-guard] error: ${err?.message ?? err}\n`);
	process.exit(0); // never block the agent on a hook crash
});
