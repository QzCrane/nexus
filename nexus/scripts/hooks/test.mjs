#!/usr/bin/env bun
// test.mjs
//
// Unified smoke-test runner for every AI-tool hook in
// nexus/scripts/hooks/. Spawns each hook with a synthetic stdin
// payload, captures stdout + exit code, and asserts the expected
// allow/block outcome.
//
// Run via:   bun scripts/hooks/test.mjs
// Or:        bun --cwd nexus scripts/hooks/test.mjs
//
// Each case is { name, hook, stdin (string), expectExit, expectText? }.
//   expectExit:  0 = allow, 2 = block
//   expectText:  optional regex that must match stdout/stderr
//
// Adding a new case is mechanical: pick a hook, build a payload,
// decide what should happen. This file is the single source of truth
// for hook behavior.

import { spawnSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = here;

/** Spawn a hook with a JSON payload on stdin, return { status, stdout, stderr }. */
function runHook(hookName, payload) {
	const script = join(hooksDir, hookName);
	const proc = spawnSync('bun', [script], {
		input: JSON.stringify(payload),
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	return {
		status: proc.status ?? -1,
		stdout: proc.stdout ?? '',
		stderr: proc.stderr ?? '',
	};
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, hook, payload, expectExit, expectText) {
	const r = runHook(hook, payload);
	const ok = r.status === expectExit;
	const textOk = expectText ? new RegExp(expectText).test(r.stdout + r.stderr) : true;
	const final = ok && textOk;
	if (final) {
		pass++;
		console.log(`  ok    ${hook} :: ${name}`);
	} else {
		fail++;
		failures.push({ name, hook, r, expectExit, expectText });
		console.log(`  FAIL  ${hook} :: ${name}  (exit=${r.status}, want=${expectExit})`);
		if (r.stdout) console.log(`        stdout: ${r.stdout.trim().split('\n').join('\n        ')}`);
		if (r.stderr) console.log(`        stderr: ${r.stderr.trim().split('\n').join('\n        ')}`);
	}
}

const FRONTMATTER = '---\ntype: explanation\nstatus: stable\naudience: developer\n---\n# ok\n';

console.log('=== ai-pre-write-guard.mjs ===');
check(
	'blocks write to docs/_archive/',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/docs/_archive/x.md', content: FRONTMATTER } },
	2,
	'BLOCKED',
);
check(
	'blocks write to AGENTS.md',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'AGENTS.md', content: FRONTMATTER } },
	2,
	'AGENTS\\.md',
);
check(
	'blocks write to control-architecture index',
	'ai-pre-write-guard.mjs',
	{
		tool_name: 'Write',
		tool_input: {
			file_path: 'nexus/apps/extension-spectra/docs/control-architecture.md',
			content: FRONTMATTER,
		},
	},
	2,
	'progressive-disclosure',
);
check(
	'blocks write to a progressive-disclosure topic file',
	'ai-pre-write-guard.mjs',
	{
		tool_name: 'Write',
		tool_input: {
			file_path: 'nexus/apps/extension-spectra/docs/control/01-foundations.md',
			content: FRONTMATTER,
		},
	},
	2,
	'progressive-disclosure',
);
check(
	'blocks .md write without frontmatter',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: '# no fm\n' } },
	2,
	'frontmatter',
);
check(
	'blocks .md write with malformed frontmatter',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: '---\ntitle: x\n---\n# body\n' } },
	2,
	'frontmatter',
);
check(
	'allows a clean .md write',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/docs/foo.md', content: FRONTMATTER } },
	0,
);
check(
	'allows a clean .ts write (no frontmatter required)',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/scripts/foo.ts', content: 'export {};\n' } },
	0,
);
check(
	'ignores non-write tools',
	'ai-pre-write-guard.mjs',
	{ tool_name: 'Read', tool_input: { file_path: 'AGENTS.md' } },
	0,
);
check(
	'handles MultiEdit by checking every target',
	'ai-pre-write-guard.mjs',
	{
		tool_name: 'MultiEdit',
		tool_input: {
			edits: [
				{ file_path: 'nexus/docs/foo.md' },
				{ file_path: 'nexus/docs/_archive/bar.md' },
			],
		},
	},
	2,
	'_archive',
);

console.log('\n=== codex-bash-guard.mjs ===');
check(
	'blocks rm targeting _archive',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'rm -rf nexus/docs/_archive/x' } },
	2,
	'_archive',
);
check(
	'blocks redirect into AGENTS.md',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'echo pwned > AGENTS.md' } },
	2,
	'AGENTS\\.md',
);
check(
	'blocks sed -i on AGENTS.md',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: "sed -i 's/a/b/g' AGENTS.md" } },
	2,
	'sed -i',
);
check(
	'blocks git restore of staged safety file',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'git restore --staged nexus/scripts/lint-docs.mjs' } },
	2,
	'Discarding',
);
check(
	'blocks bulk rm -rf /',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
	2,
	'workspace root',
);
check(
	'blocks smuggled command chain `cd / && rm ...`',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'cd / && rm -rf AGENTS.md' } },
	2,
	'AGENTS\\.md',
);
check(
	'blocks pipe-driven target',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'cat foo | tee docs/_archive/x' } },
	2,
	'_archive',
);
check(
	'allows plain git status',
	'codex-bash-guard.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'git status' } },
	0,
);
check(
	'ignores non-Bash tools',
	'codex-bash-guard.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'AGENTS.md', content: 'x' } },
	0,
);

console.log('\n=== ai-post-write-lint.mjs ===');
// PostToolUse is non-blocking; we just assert it exits 0 and prints
// no warning when the file is OK, or prints a warning when the file
// is bad (we use an obviously bad file path that doesn't exist to
// avoid touching the real tree).
check(
	'exits 0 on a missing target (nothing to do)',
	'ai-post-write-lint.mjs',
	{ tool_name: 'Write', tool_input: { file_path: 'nexus/this/does/not/exist.md' } },
	0,
);
check(
	'ignores non-write tools',
	'ai-post-write-lint.mjs',
	{ tool_name: 'Bash', tool_input: { command: 'ls' } },
	0,
);

console.log('\n=== checkpoint hooks (smoke) ===');
// Checkpoint hooks just drain stdin and print a status; assert exit 0.
for (const h of ['ai-stop-checkpoint.mjs', 'codex-stop-checkpoint.mjs']) {
	check('exits 0 on empty stdin', h, {}, 0, 'turn ending');
	check('exits 0 on payload stdin', h, { tool_name: 'Write' }, 0, 'turn ending');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
	process.exit(1);
}
