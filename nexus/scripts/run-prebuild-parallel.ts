#!/usr/bin/env bun
// run-prebuild-parallel.ts
//
// Runs the three independent prebuild gates in parallel:
//   1. sync:skills   — refreshes the AGENTS.md skill table (~0.2s)
//   2. docs:check     — lints markdown docs / frontmatter (~0.8s)
//   3. verify:q       — architecture integrity checks (~4.1s)
//
// These share no data dependency:
//   - sync:skills only writes the skill-table region inside AGENTS.md;
//   - verify:q only checks that AGENTS.md EXISTS (check-ai-context.js),
//     never its content; and does not run docs:check internally;
//   - docs:check is a read-only markdown lint.
//
// Serial `&&` chain wall-clock ≈ 5.1s; parallel collapses to the slowest
// gate (verify:q ≈ 4.1s). Output is buffered and printed in declaration
// order so the log stays deterministic regardless of completion order.
//
// Run via:  bun run prebuild   (package.json delegates here)

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const commands = [
	{ name: 'sync:skills', args: ['run', 'sync:skills'] },
	{ name: 'docs:check', args: ['run', 'docs:check'] },
	{ name: 'verify:q', args: ['run', 'verify:q'] },
];

function runParallel(name, args) {
	return new Promise((resolve) => {
		const proc = spawn(process.execPath, args, {
			cwd: workspaceDir,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		});
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (c) => { stdout += c; });
		proc.stderr.on('data', (c) => { stderr += c; });
		proc.on('error', () => resolve({ name, status: -1, stdout, stderr }));
		proc.on('close', (status) => resolve({ name, status: status ?? -1, stdout, stderr }));
	});
}

const results = await Promise.all(commands.map((c) => runParallel(c.name, c.args)));

let failed = false;
for (const r of results) {
	const tag = r.status === 0 ? 'ok  ' : 'FAIL';
	console.log(`[${tag}] ${r.name}`);
	if (r.stdout) process.stdout.write(r.stdout);
	if (r.stderr) process.stderr.write(r.stderr);
	if (r.status !== 0) failed = true;
}

if (failed) {
	console.error('prebuild: one or more gates failed');
	process.exit(1);
}
