#!/usr/bin/env bun
// test.mjs
//
// Unified test runner for every AI-tool hook in nexus/scripts/hooks/.
// Three test layers, all data-driven:
//
//   A. helper unit tests     — test _hook-helpers.mjs pure functions
//   B. hook smoke tests      — spawn each hook with synthetic stdin
//   C. config validator      — verify .claude/settings.json and
//                              .codex/hooks.json reference files
//                              that actually exist
//
// Run via:   bun scripts/hooks/test.mjs
// Or:        bun --cwd nexus scripts/hooks/test.mjs
// Or:        bun run hooks:test
//
// With NEXUS_HOOK_DEBUG=1, every spawned hook also dumps its parsed
// payload and decision flow to stderr — useful for understanding a
// failing case:
//   NEXUS_HOOK_DEBUG=1 bun scripts/hooks/test.mjs

import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	extractBashCommand,
	extractWriteTargets,
	formatBlockMessage,
	formatCheckpointMessage,
	parsePayload,
	relPath,
	WRITE_TOOLS,
} from './_hook-helpers.mjs';
import { frontmatterProblem } from './ai-pre-write-guard.mjs';
import { strictLintTargets } from './ai-post-write-lint.mjs';
import { splitCommands } from './codex-bash-guard.mjs';
import { scanFileContent } from './ai-pitfall-detector.mjs';
import {
	parseArguments as parseSyncSkillsArguments,
	syncIndexFile,
} from '../sync-skills.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = here;
// repo root is two levels up from hooksDir (nexus/scripts/hooks)
const repoRoot = normalize(join(hooksDir, '..', '..', '..'));

let pass = 0;
let fail = 0;
const failures = [];

// ---------- assertion primitives --------------------------------------

/**
 * Loose deep-equal for primitives, arrays, and plain objects.
 * Handles null/undefined, numbers, strings, booleans.
 */
function deepEqual(a, b) {
	if (a === b) return true;
	if (a === null || a === undefined || b === null || b === undefined) {
		return a === b;
	}
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	if (typeof a === 'object') {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		return ka.every((k) => deepEqual(a[k], b[k]));
	}
	return false;
}

function ok(name, cond, detail = '') {
	if (cond) {
		pass++;
		console.log(`  ok    ${name}`);
	} else {
		fail++;
		failures.push(name);
		console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
	}
}

function eq(name, actual, expected) {
	ok(name, deepEqual(actual, expected), `got=${JSON.stringify(actual)}, want=${JSON.stringify(expected)}`);
}

// ---------- spawn a hook with a JSON stdin payload --------------------

function runHook(hookName, payload) {
	const script = join(hooksDir, hookName);
	const proc = spawnSync(process.execPath, [script], {
		input: JSON.stringify(payload),
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		// biome-ignore lint/suspicious/noUndeclaredEnvVars: forward the debug env var so spawned hooks can trace their payload
		env: { ...process.env, NEXUS_HOOK_DEBUG: process.env.NEXUS_HOOK_DEBUG ?? '' },
	});
	return {
		status: proc.status ?? -1,
		stdout: proc.stdout ?? '',
		stderr: proc.stderr ?? '',
	};
}

// =====================================================================
// A. Helper unit tests — pure functions, no spawning
// =====================================================================

console.log('=== A. helper unit tests (_hook-helpers.mjs) ===');

// parsePayload: safe JSON parsing
eq('parsePayload: empty string → {}', parsePayload(''), {});
eq('parsePayload: null → {}', parsePayload(null), {});
eq('parsePayload: undefined → {}', parsePayload(undefined), {});
eq('parsePayload: malformed JSON → {}', parsePayload('{not json'), {});
eq('parsePayload: valid JSON → object', parsePayload('{"a":1}'), { a: 1 });
eq('parsePayload: JSON array → {} (not an object)', parsePayload('[1,2,3]'), {});
eq('parsePayload: JSON string → {} (not an object)', parsePayload('"hello"'), {});
eq('parsePayload: JSON number → {} (not an object)', parsePayload('42'), {});

// extractWriteTargets: pulls file paths from Write/Edit/MultiEdit
eq(
	'extractWriteTargets: Write',
	extractWriteTargets({ tool_name: 'Write', tool_input: { file_path: '/a/b.md' } }),
	['/a/b.md'],
);
eq(
	'extractWriteTargets: Edit (single file_path)',
	extractWriteTargets({ tool_name: 'Edit', tool_input: { file_path: '/a/c.md' } }),
	['/a/c.md'],
);
eq(
	'extractWriteTargets: MultiEdit (edits array)',
	extractWriteTargets({
		tool_name: 'MultiEdit',
		tool_input: { edits: [{ file_path: '/a/d.md' }, { file_path: '/a/e.md' }] },
	}),
	['/a/d.md', '/a/e.md'],
);
eq('extractWriteTargets: empty payload', extractWriteTargets({}), []);
eq(
	'extractWriteTargets: missing file_path',
	extractWriteTargets({ tool_input: {} }),
	[],
);
eq(
	'extractWriteTargets: malformed edits (no file_path)',
	extractWriteTargets({ tool_input: { edits: [{ foo: 'bar' }, { file_path: '/x' }] } }),
	['/x'],
);

// extractBashCommand: pulls command from Codex Bash payload
eq(
	'extractBashCommand: Bash payload',
	extractBashCommand({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
	'ls -la',
);
eq('extractBashCommand: non-Bash tool', extractBashCommand({ tool_name: 'Write' }), '');
eq('extractBashCommand: Bash missing command', extractBashCommand({ tool_name: 'Bash', tool_input: {} }), '');
eq('extractBashCommand: Bash non-string command', extractBashCommand({ tool_name: 'Bash', tool_input: { command: 42 } }), '');
eq('extractBashCommand: empty payload', extractBashCommand({}), '');

// relPath: normalizes to repo-relative POSIX
// Note: the assertions below use forward slashes regardless of
// platform because relPath always returns POSIX paths.
ok('relPath: empty string', relPath('') === '');
ok('relPath: null', relPath(null) === '');
ok('relPath: non-string', relPath(42) === '');
// We don't assert exact values because they depend on CWD;
// instead assert that the result uses forward slashes and is
// non-empty when given a real path.
const r = relPath('AGENTS.md');
ok('relPath: returns forward-slash path', !r.includes('\\'));
ok('relPath: AGENTS.md resolves within repo', r === 'AGENTS.md' || r.endsWith('AGENTS.md'));

// WRITE_TOOLS: shared set covers Claude + Codex tool names
ok('WRITE_TOOLS: has Write', WRITE_TOOLS.has('Write'));
ok('WRITE_TOOLS: has Edit', WRITE_TOOLS.has('Edit'));
ok('WRITE_TOOLS: has MultiEdit', WRITE_TOOLS.has('MultiEdit'));
ok('WRITE_TOOLS: missing Read', !WRITE_TOOLS.has('Read'));

// strictLintTargets: the post-write hook delegates to the workspace's
// non-mutating strict owner and refuses paths outside this repository.
eq(
	'strictLintTargets: maps workspace and root files from repository cwd',
	strictLintTargets(
		[
			'nexus/scripts/hooks/ai-post-write-lint.mjs',
			'commitlint.config.mjs',
		],
		repoRoot,
	),
	['scripts/hooks/ai-post-write-lint.mjs', '../commitlint.config.mjs'],
);
eq(
	'strictLintTargets: rejects files outside the repository',
	strictLintTargets([join(repoRoot, '..', 'outside.ts')], repoRoot),
	[],
);

// formatBlockMessage: produces the standard BLOCKED layout
eq(
	'formatBlockMessage: full payload (reason + target + tool + rule)',
	formatBlockMessage({ reason: 'no', target: 'AGENTS.md', tool: 'Write', rule: 'EPR-029' }),
	'[hook] BLOCKED AGENTS.md\n  reason: no\n  tool:   Write\n  rule:   EPR-029\n',
);
eq(
	'formatBlockMessage: omits tool+rule when not given',
	formatBlockMessage({ reason: 'no', target: 'x.md' }),
	'[hook] BLOCKED x.md\n  reason: no\n',
);
eq(
	'formatBlockMessage: empty reason still renders',
	formatBlockMessage({ reason: '', target: 'x.md' }),
	'[hook] BLOCKED x.md\n  reason: \n',
);

// formatCheckpointMessage: stable header + rule-of-thumb footer
{
	const msg = formatCheckpointMessage('ai-stop-checkpoint');
	ok('formatCheckpointMessage: starts with header', msg.startsWith('[ai-stop-checkpoint] turn ending.\n'));
	ok('formatCheckpointMessage: contains rule of thumb', msg.includes('rule of thumb: each closed-loop commit'));
	ok('formatCheckpointMessage: ends with newline', msg.endsWith('\n'));
	ok('formatCheckpointMessage: name parameter is interpolated', !msg.startsWith('[hook]'));
}
{
	const msg = formatCheckpointMessage('codex-stop-checkpoint');
	ok('formatCheckpointMessage: codex header', msg.startsWith('[codex-stop-checkpoint] turn ending.\n'));
}

// splitCommands: metacharacter splitting
eq('splitCommands: empty string → []', splitCommands(''), []);
eq('splitCommands: whitespace only → []', splitCommands('   '), []);
eq('splitCommands: single command', splitCommands('git status'), ['git status']);
eq('splitCommands: && separator', splitCommands('cd / && rm x'), ['cd /', 'rm x']);
eq('splitCommands: || separator', splitCommands('a || b'), ['a', 'b']);
eq('splitCommands: ; separator', splitCommands('a; b; c'), ['a', 'b', 'c']);
eq('splitCommands: mixed && and ;', splitCommands('a && b; c || d'), ['a', 'b', 'c', 'd']);
eq('splitCommands: trailing separator is trimmed', splitCommands('a &&'), ['a']);
eq('splitCommands: newline as separator', splitCommands('rm x\nrm y'), ['rm x', 'rm y']);
eq('splitCommands: pipe-newline separator', splitCommands('a |\nb'), ['a', 'b']);

// frontmatterProblem: Diátaxis frontmatter validation
eq('frontmatterProblem: non-.md file → null', frontmatterProblem('foo.ts', 'export {}'), null);
eq('frontmatterProblem: CHANGELOG.md → null (exempt)', frontmatterProblem('CHANGELOG.md', '# changes\n'), null);
eq('frontmatterProblem: empty content → null', frontmatterProblem('foo.md', ''), null);
eq('frontmatterProblem: missing --- delimiter', frontmatterProblem('foo.md', '# no fm\n'), 'missing frontmatter delimiter `---`');
eq('frontmatterProblem: unterminated frontmatter', frontmatterProblem('foo.md', '---\ntype: explanation\n'), 'unterminated frontmatter block');
eq('frontmatterProblem: missing type', frontmatterProblem('foo.md', '---\nstatus: stable\naudience: dev\n---\n'), 'frontmatter missing `type` (explanation/tutorial/how-to/reference)');
eq('frontmatterProblem: missing status', frontmatterProblem('foo.md', '---\ntype: explanation\naudience: dev\n---\n'), 'frontmatter missing `status` (stable/draft/deprecated)');
eq('frontmatterProblem: missing audience', frontmatterProblem('foo.md', '---\ntype: explanation\nstatus: stable\n---\n'), 'frontmatter missing `audience`');
eq('frontmatterProblem: complete frontmatter → null', frontmatterProblem('foo.md', '---\ntype: how-to\nstatus: stable\naudience: developer\n---\n# ok\n'), null);
eq('frontmatterProblem: type=reference ok', frontmatterProblem('foo.md', '---\ntype: reference\nstatus: draft\naudience: contributor\n---\n'), null);
ok('frontmatterProblem: content after frontmatter is ignored', frontmatterProblem('foo.md', '---\ntype: explanation\nstatus: stable\naudience: x\n---\n# body') === null);

// =====================================================================
// B. Hook smoke tests — table-driven
// =====================================================================

console.log('\n=== B. hook smoke tests ===');

const FRONTMATTER = '---\ntype: explanation\nstatus: stable\naudience: developer\n---\n# ok\n';

/**
 * A single smoke case.
 * @typedef {Object} Case
 * @property {string} name       — human-readable label
 * @property {string} hook       — hook script filename
 * @property {object} payload    — stdin payload
 * @property {number} expectExit — 0 (allow) or 2 (block)
 * @property {string} [expectText] — optional regex to match on stdout+stderr
 */
const cases = [
	// --- ai-pre-write-guard.mjs --------------------------------------
	{
		name: 'pre-write: blocks docs/_archive/',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/_archive/x.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'BLOCKED.*_archive',
	},
	{
		name: 'pre-write: blocks AGENTS.md',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'AGENTS.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'AGENTS\\.md',
	},
	{
		name: 'pre-write: blocks CLAUDE.md',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'CLAUDE.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'CLAUDE\\.md',
	},
	{
		name: 'pre-write: blocks control-architecture index',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/apps/extension-spectra/docs/control-architecture.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'progressive-disclosure',
	},
	{
		name: 'pre-write: blocks control/01-foundations.md topic file',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/apps/extension-spectra/docs/control/01-foundations.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'progressive-disclosure',
	},
	{
		name: 'pre-write: blocks principles/01-*.md topic file',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/principles/01-state-and-ownership.md', content: FRONTMATTER } },
		expectExit: 2,
		expectText: 'progressive-disclosure',
	},
	{
		name: 'pre-write: blocks .md without frontmatter',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: '# no fm\n' } },
		expectExit: 2,
		expectText: 'frontmatter',
	},
	{
		name: 'pre-write: blocks .md with malformed frontmatter (no type)',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: '---\ntitle: x\n---\n# body\n' } },
		expectExit: 2,
		expectText: 'frontmatter',
	},
	{
		name: 'pre-write: blocks .md with type but no status',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: '---\ntype: explanation\naudience: dev\n---\n' } },
		expectExit: 2,
		expectText: 'status',
	},
	{
		name: 'pre-write: allows clean .md write',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: FRONTMATTER } },
		expectExit: 0,
	},
	{
		name: 'pre-write: allows .ts write (no frontmatter required)',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/scripts/foo.ts', content: 'export {};\n' } },
		expectExit: 0,
	},
	{
		name: 'pre-write: allows CHANGELOG.md without frontmatter',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/CHANGELOG.md', content: '# changelog\n' } },
		expectExit: 0,
	},
	{
		name: 'pre-write: ignores non-write tools',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'Read', tool_input: { file_path: 'AGENTS.md' } },
		expectExit: 0,
	},
	{
		name: 'pre-write: MultiEdit checks every target',
		hook: 'ai-pre-write-guard.mjs',
		payload: { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: 'nexus/docs/foo.md' }, { file_path: 'nexus/docs/_archive/bar.md' }] } },
		expectExit: 2,
		expectText: '_archive',
	},

	// --- codex-bash-guard.mjs -----------------------------------------
	{
		name: 'bash: blocks rm targeting _archive',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'rm -rf nexus/docs/_archive/x' } },
		expectExit: 2,
		expectText: '_archive',
	},
	{
		name: 'bash: blocks mv targeting AGENTS.md',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'mv AGENTS.md AGENTS.bak' } },
		expectExit: 2,
		expectText: 'AGENTS\\.md',
	},
	{
		name: 'bash: blocks redirect into CLAUDE.md',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'echo pwned > CLAUDE.md' } },
		expectExit: 2,
		expectText: 'CLAUDE\\.md',
	},
	{
		name: 'bash: blocks sed -i on AGENTS.md',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: "sed -i 's/a/b/g' AGENTS.md" } },
		expectExit: 2,
		expectText: 'sed -i',
	},
	{
		name: 'bash: blocks git restore of staged safety file',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'git restore --staged nexus/scripts/lint-docs.mjs' } },
		expectExit: 2,
		expectText: 'Discarding',
	},
	{
		name: 'bash: blocks bulk rm -rf /',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
		expectExit: 2,
		expectText: 'workspace root',
	},
	{
		name: 'bash: blocks smuggled command chain `cd / && rm ...`',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'cd / && rm -rf AGENTS.md' } },
		expectExit: 2,
		expectText: 'AGENTS\\.md',
	},
	{
		name: 'bash: blocks pipe-driven target via tee',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'cat foo | tee docs/_archive/x' } },
		expectExit: 2,
		expectText: '_archive',
	},
	{
		name: 'bash: blocks cp into AGENTS.md',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'cp backup.md AGENTS.md' } },
		expectExit: 2,
		expectText: 'AGENTS\\.md',
	},
	{
		name: 'bash: allows plain git status',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'git status' } },
		expectExit: 0,
	},
	{
		name: 'bash: allows complex but safe pipeline',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'bun run test | grep "passed"' } },
		expectExit: 0,
	},
	{
		name: 'bash: ignores non-Bash tools',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'AGENTS.md', content: 'x' } },
		expectExit: 0,
	},
	{
		name: 'bash: ignores empty command',
		hook: 'codex-bash-guard.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: '' } },
		expectExit: 0,
	},

	// --- ai-post-write-lint.mjs --------------------------------------
	{
		name: 'post-write: exits 0 on a missing target (nothing to do)',
		hook: 'ai-post-write-lint.mjs',
		payload: { tool_name: 'Write', tool_input: { file_path: 'nexus/this/does/not/exist.md' } },
		expectExit: 0,
	},
	{
		name: 'post-write: ignores non-write tools',
		hook: 'ai-post-write-lint.mjs',
		payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
		expectExit: 0,
	},

	// --- checkpoint hooks --------------------------------------------
	{
		name: 'ai-stop: exits 0 on empty stdin',
		hook: 'ai-stop-checkpoint.mjs',
		payload: {},
		expectExit: 0,
		expectText: 'turn ending',
	},
	{
		name: 'ai-stop: exits 0 on payload stdin',
		hook: 'ai-stop-checkpoint.mjs',
		payload: { tool_name: 'Write' },
		expectExit: 0,
		expectText: 'turn ending',
	},
	{
		name: 'codex-stop: exits 0 on empty stdin',
		hook: 'codex-stop-checkpoint.mjs',
		payload: {},
		expectExit: 0,
		expectText: 'turn ending',
	},
	{
		name: 'codex-stop: exits 0 on payload stdin',
		hook: 'codex-stop-checkpoint.mjs',
		payload: { tool_name: 'Write' },
		expectExit: 0,
		expectText: 'turn ending',
	},
];

for (const c of cases) {
	const r = runHook(c.hook, c.payload);
	const exitOk = r.status === c.expectExit;
	const textOk = c.expectText ? new RegExp(c.expectText).test(r.stdout + r.stderr) : true;
	if (exitOk && textOk) {
		pass++;
		console.log(`  ok    ${c.name}`);
	} else {
		fail++;
		failures.push(c.name);
		console.log(`  FAIL  ${c.name}  (exit=${r.status}, want=${c.expectExit})`);
		if (r.stdout) console.log(`        stdout: ${r.stdout.trim().split('\n').join('\n        ')}`);
		if (r.stderr) console.log(`        stderr: ${r.stderr.trim().split('\n').join('\n        ')}`);
	}
}

// =====================================================================
// D. ai-pitfall-detector unit tests — scanFileContent pure function
// =====================================================================

console.log('\n=== D. ai-pitfall-detector unit tests ===');

function hasRule(issues, rule) {
	return issues.some((i) => i.rule === rule);
}

function ruleCount(issues, rule) {
	return issues.filter((i) => i.rule === rule).length;
}

// Rule 1: storage-write-uncaught
ok('pitfall/storage-write-uncaught: bare storage.set flagged',
	hasRule(scanFileContent('a.ts', 'chrome.storage.local.set({x:1});\n'), 'storage-write-uncaught'));
ok('pitfall/storage-write-uncaught: safeStorageSet flagged',
	hasRule(scanFileContent('a.ts', 'await safeStorageSet({x:1});\n'), 'storage-write-uncaught'));
ok('pitfall/storage-write-uncaught: try-block not flagged',
	!hasRule(scanFileContent('a.ts', 'try {\n  chrome.storage.local.set({x:1});\n} catch (e) {}\n'), 'storage-write-uncaught'));
ok('pitfall/storage-write-uncaught: .catch() not flagged',
	!hasRule(scanFileContent('a.ts', 'await chrome.storage.local.set({x:1}).catch(() => undefined);\n'), 'storage-write-uncaught'));
ok('pitfall/storage-write-uncaught: bypass comment skips',
	!hasRule(scanFileContent('a.ts', 'chrome.storage.local.set({x:1}); // bypass-storage-check\n'), 'storage-write-uncaught'));

// Rule 2: fetch-uncaught
ok('pitfall/fetch-uncaught: bare await fetch flagged',
	hasRule(scanFileContent('a.ts', 'await fetch(url);\n'), 'fetch-uncaught'));
ok('pitfall/fetch-uncaught: fetch().then without catch flagged',
	hasRule(scanFileContent('a.ts', 'fetch(url).then(r => r.json());\n'), 'fetch-uncaught'));
ok('pitfall/fetch-uncaught: try-block not flagged',
	!hasRule(scanFileContent('a.ts', 'try {\n  await fetch(url);\n} catch (e) {}\n'), 'fetch-uncaught'));
ok('pitfall/fetch-uncaught: chained .catch not flagged',
	!hasRule(scanFileContent('a.ts', 'await fetch(url).then(r => r.json()).catch(() => undefined);\n'), 'fetch-uncaught'));
ok('pitfall/fetch-uncaught: biome-ignore line not flagged',
	!hasRule(scanFileContent('a.ts', '// biome-ignore lint/suspicious/noExplicitAny: allow\nawait fetch(url);\n'), 'fetch-uncaught'));

// Rule 3: listener-leak
ok('pitfall/listener-leak: addEventListener without remove flagged',
	hasRule(scanFileContent('a.ts', 'el.addEventListener("click", handler);\n'), 'listener-leak'));
ok('pitfall/listener-leak: matching remove not flagged',
	!hasRule(scanFileContent('a.ts', 'el.addEventListener("click", handler);\nel.removeEventListener("click", handler);\n'), 'listener-leak'));
ok('pitfall/listener-leak: different event types flagged independently',
	ruleCount(scanFileContent('a.ts', 'el.addEventListener("click", h1);\nel.addEventListener("keydown", h2);\nel.removeEventListener("click", h1);\n'), 'listener-leak') === 1);

// Rule 4: ssrf-fetch
ok('pitfall/ssrf-fetch: dynamic fetch flagged',
	hasRule(scanFileContent('a.ts', 'await fetch(userUrl);\n'), 'ssrf-fetch'));
ok('pitfall/ssrf-fetch: template literal http flagged',
	hasRule(scanFileContent('a.ts', 'await fetch(`https://' + '$' + '{host}/api`);\n'), 'ssrf-fetch'));
ok('pitfall/ssrf-fetch: relative path not flagged',
	!hasRule(scanFileContent('a.ts', 'await fetch("./local");\n'), 'ssrf-fetch'));
ok('pitfall/ssrf-fetch: isPrivateHost import disables rule',
	!hasRule(scanFileContent('a.ts', 'import { isPrivateHost } from "./ssrf.js";\nawait fetch(userUrl);\n'), 'ssrf-fetch'));
ok('pitfall/ssrf-fetch: preceding isPrivateHost check not flagged',
	!hasRule(scanFileContent('a.ts', 'if (isPrivateHost(url.hostname)) return;\nawait fetch(url);\n'), 'ssrf-fetch'));

// Rule 5: serialized-queue-broken-chain
ok('pitfall/serialized-queue: opQueue.then without catch flagged',
	hasRule(scanFileContent('a.ts', 'opQueue = opQueue.then(() => fn());\n'), 'serialized-queue-broken-chain'));
ok('pitfall/serialized-queue: opQueue.then with .catch not flagged',
	!hasRule(scanFileContent('a.ts', 'opQueue = opQueue.then(() => fn()).catch(() => undefined);\n'), 'serialized-queue-broken-chain'));
ok('pitfall/serialized-queue: queue.then with .catch not flagged',
	!hasRule(scanFileContent('a.ts', 'queue = queue.then(() => fn()).catch(() => undefined);\n'), 'serialized-queue-broken-chain'));

// Rule 6: onmessage-async-no-return
ok('pitfall/onmessage-async: listener without return true flagged',
	hasRule(scanFileContent('a.ts', 'chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {\n  sendResponse(await work());\n});\n'), 'onmessage-async-no-return'));
ok('pitfall/onmessage-async: listener with return true not flagged',
	!hasRule(scanFileContent('a.ts', 'chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {\n  sendResponse(await work());\n  return true;\n});\n'), 'onmessage-async-no-return'));

// Rule 7: deep-path-import
ok('pitfall/deep-path-import: @nexus/contracts/src flagged',
	hasRule(scanFileContent('a.ts', 'import { X } from "@nexus/contracts/src/foo";\n'), 'deep-path-import'));
ok('pitfall/deep-path-import: @nexus/kernel/storage not flagged',
	!hasRule(scanFileContent('a.ts', 'import { X } from "@nexus/kernel/storage";\n'), 'deep-path-import'));
ok('pitfall/deep-path-import: @nexus/contracts root not flagged',
	!hasRule(scanFileContent('a.ts', 'import { X } from "@nexus/contracts";\n'), 'deep-path-import'));

// Rule 8: branded-type-reuse
ok('pitfall/branded-type: TabId import flagged',
	hasRule(scanFileContent('a.ts', 'import { TabId } from "./types";\n'), 'branded-type-reuse'));
ok('pitfall/branded-type: VolumeLevel type reference flagged',
	hasRule(scanFileContent('a.ts', 'function f(x: VolumeLevel): void {}\n'), 'branded-type-reuse'));
ok('pitfall/branded-type: DomainName import flagged',
	hasRule(scanFileContent('a.ts', 'import type { DomainName } from "./types";\n'), 'branded-type-reuse'));
ok('pitfall/branded-type: string literal not flagged',
	!hasRule(scanFileContent('a.ts', 'const x = "TabId";\n'), 'branded-type-reuse'));

// Rule 9: missing-js-extension
ok('pitfall/missing-js-extension: relative import without ext flagged',
	hasRule(scanFileContent('a.ts', 'import { x } from "./foo";\n'), 'missing-js-extension'));
ok('pitfall/missing-js-extension: .js not flagged',
	!hasRule(scanFileContent('a.ts', 'import { x } from "./foo.js";\n'), 'missing-js-extension'));
ok('pitfall/missing-js-extension: .json not flagged',
	!hasRule(scanFileContent('a.ts', 'import data from "./data.json";\n'), 'missing-js-extension'));
ok('pitfall/missing-js-extension: .css not flagged',
	!hasRule(scanFileContent('a.ts', 'import "./style.css";\n'), 'missing-js-extension'));
ok('pitfall/missing-js-extension: biome-ignore line not flagged',
	!hasRule(scanFileContent('a.ts', '// biome-ignore lint/style/useImportType: allow\nimport { x } from "./foo";\n'), 'missing-js-extension'));
ok('pitfall/missing-js-extension: package import not flagged',
	!hasRule(scanFileContent('a.ts', 'import { x } from "@nexus/contracts";\n'), 'missing-js-extension'));

// Scan integration: returns sorted issues
{
	const issues = scanFileContent('a.ts', 'chrome.storage.local.set({x:1});\nawait fetch(url);\n');
	ok('pitfall/integration: returns multiple issues', issues.length >= 2);
	ok('pitfall/integration: issues sorted by line', issues.every((i, idx) => idx === 0 || issues[idx - 1].line <= i.line));
}

// CLI mode: no args → no changed files (smoke)
{
	const r = runHook('ai-pitfall-detector.mjs', {});
	// Hook returns its own exit logic; non-zero errors are acceptable
	// here because git may be missing. Just assert it does not crash.
	ok('pitfall/cli: empty payload exits 0 or 1', r.status === 0 || r.status === 1);
}

// =====================================================================
// C. config validator — verify .claude/.codex hook commands resolve
// =====================================================================

console.log('\n=== C. config validator ===');

/**
 * Parse a hook config JSON, return list of {config, matcher, command}
 * for every hook entry. Tolerates missing files (returns empty list).
 */
function extractHookCommands(configPath) {
	if (!existsSync(configPath)) return [];
	const json = JSON.parse(readFileSync(configPath, 'utf8'));
	const out = [];
	const groups = json.hooks ?? {};
	for (const [phase, entries] of Object.entries(groups)) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			const matcher = entry.matcher ?? '*';
			for (const h of entry.hooks ?? []) {
				if (typeof h.command === 'string') {
					out.push({ config: configPath, phase, matcher, command: h.command });
				}
			}
		}
	}
	return out;
}

/**
 * Extract a script path from a hook command string. Recognizes:
 *   `bun --cwd nexus scripts/hooks/foo.mjs`     → nexus/scripts/hooks/foo.mjs
 *   `bun scripts/hooks/foo.mjs`                 → scripts/hooks/foo.mjs
 *   `bun scripts/hooks/foo.mjs arg1 arg2`        → scripts/hooks/foo.mjs
 *
 * Honors `--cwd <dir>` by prepending <dir>/ to the script path so
 * the result resolves correctly against the repo root.
 *
 * Returns the empty string if no script path can be identified.
 */
function scriptPathFromCommand(command) {
	const tokens = command.trim().split(/\s+/);
	let i = 0;
	// skip env-var assignments (FOO=bar)
	while (i < tokens.length && tokens[i].includes('=')) i++;
	// skip the runner (bun, bunx, node, etc.)
	while (
		i < tokens.length &&
		['bun', 'bunx', 'node', 'npx', 'pnpm', 'yarn'].includes(tokens[i])
	) {
		i++;
	}
	// walk flags; remember --cwd <dir> so we can prepend it
	let cwdPrefix = '';
	while (i < tokens.length && tokens[i].startsWith('--')) {
		if (['--cwd', '--config-path', '--root'].includes(tokens[i])) {
			cwdPrefix = tokens[i + 1] ?? '';
			i += 2;
		} else {
			i += 1;
		}
	}
	if (i >= tokens.length) return '';
	const candidate = tokens[i];
	if (!/\.(mjs|cjs|js)$/.test(candidate)) return '';
	// strip a leading ./ if present
	const clean = candidate.replace(/^\.\//, '');
	return cwdPrefix ? `${cwdPrefix}/${clean}` : clean;
}

const configPaths = [
	join(repoRoot, '.claude', 'settings.json'),
	join(repoRoot, '.codex', 'hooks.json'),
];

let configEntries = 0;
for (const cfg of configPaths) {
	const entries = extractHookCommands(cfg);
	configEntries += entries.length;
	for (const e of entries) {
		const script = scriptPathFromCommand(e.command);
		ok(
			`${e.config} :: ${e.phase}/${e.matcher}: command has script path`,
			!!script,
			`command="${e.command}"`,
		);
		if (!script) continue;
		const abs = resolve(repoRoot, script);
		ok(
			`${e.config} :: ${e.phase}/${e.matcher}: ${script} exists`,
			existsSync(abs),
			`path=${abs}`,
		);
	}
}
ok('config validator: found at least one hook entry', configEntries > 0, 'no entries found');

const postWriteHookSource = readFileSync(
	join(hooksDir, 'ai-post-write-lint.mjs'),
	'utf8',
);
ok(
	'post-write: delegates JavaScript checks to the strict Biome owner',
	postWriteHookSource.includes("['scripts/run-strict-biome.mjs', ...lintTargets]"),
	'post-write JavaScript feedback must not create a second Biome command',
);
ok(
	'post-write: never rewrites JavaScript files',
	!postWriteHookSource.includes("'--write'") && !postWriteHookSource.includes('"--write"'),
	'post-write feedback must remain non-mutating',
);

const lefthookPath = join(repoRoot, 'lefthook.yml');
const lefthookConfig = readFileSync(lefthookPath, 'utf8');
ok(
	'lefthook: Bun workspace commands do not put run after --cwd',
	!/^\s*run:\s*bun\s+--cwd\s+\S+\s+run(?:\s|$)/mu.test(lefthookConfig),
	'`bun --cwd <dir> run <script>` prints help and exits successfully without running the script',
);
ok(
	'lefthook: pre-push gates run in parallel',
	/pre-push:\s*\r?\n\s+parallel:\s+true/mu.test(lefthookConfig),
	'pre-push commands are independent and read-only',
);
ok(
	'lefthook: pre-push checks skill-index drift without writing',
	/sync-skills:\s*\r?\n\s+run:\s+bun run sync:skills -- --check/mu.test(lefthookConfig),
	'pre-push must not rewrite AGENTS.md while gates run in parallel',
);

eq('sync-skills: default mode writes', parseSyncSkillsArguments([]), { checkOnly: false });
eq('sync-skills: --check is read-only', parseSyncSkillsArguments(['--check']), {
	checkOnly: true,
});
let rejectedUnknownSyncSkillsArgument = false;
try {
	parseSyncSkillsArguments(['--write']);
} catch {
	rejectedUnknownSyncSkillsArgument = true;
}
ok('sync-skills: rejects unknown arguments', rejectedUnknownSyncSkillsArgument);

const syncSkillsTempRoot = mkdtempSync(join(tmpdir(), 'nexus-sync-skills-'));
const syncSkillsTempFile = join(syncSkillsTempRoot, 'AGENTS.md');
const syncSkillsFixture = [
	'# Fixture',
	'<!-- nexus:skills-start -->',
	'stale',
	'<!-- nexus:skills-end -->',
	'',
].join('\n');
const syncSkillsRows = ['| `fixture` | Fixture skill | fixture |'];
try {
	writeFileSync(syncSkillsTempFile, syncSkillsFixture);
	let checkRejectedDrift = false;
	try {
		syncIndexFile(syncSkillsTempFile, syncSkillsRows, true);
	} catch {
		checkRejectedDrift = true;
	}
	ok('sync-skills: --check rejects index drift', checkRejectedDrift);
	eq(
		'sync-skills: --check leaves a drifted file byte-identical',
		readFileSync(syncSkillsTempFile, 'utf8'),
		syncSkillsFixture,
	);
	eq(
		'sync-skills: write mode updates a drifted index',
		syncIndexFile(syncSkillsTempFile, syncSkillsRows),
		'updated',
	);
	ok(
		'sync-skills: updated index contains the generated row',
		readFileSync(syncSkillsTempFile, 'utf8').includes(syncSkillsRows[0]),
	);
} finally {
	rmSync(syncSkillsTempRoot, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}

// =====================================================================
// Summary
// =====================================================================

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
	console.log('\nFailed cases:');
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
