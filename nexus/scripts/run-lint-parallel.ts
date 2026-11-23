#!/usr/bin/env bun
// run-lint-parallel.ts
//
// Parallel orchestrator for the three independent lint gates:
//   1. workspace-coverage   — validates lint config + runs spec tests
//   2. turbo lint            — lints every workspace package source
//   3. repository-surfaces   — lints root scripts and config files
//
// These scan disjoint file sets and share no data dependency, so they
// run concurrently. Output is buffered and printed in declaration order
// for deterministic logs regardless of completion order.
//
// --public flag switches to public-repository mode (inlined steps
// matching the PUBLIC_ROOT_LINT projection, no workspace-coverage
// subcommand since public repos don't project lint:workspace-coverage).
//
// Run via:  bun run lint            (private, delegates to package.json scripts)
//          bun scripts/run-lint-parallel.ts --public  (public repo mode)

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isPublic = process.argv.includes('--public');

function getTurboCommand(): { command: string; prefixArgs: string[] } {
	const executable = process.platform === 'win32' ? 'turbo.exe' : 'turbo';
	const candidates = [
		resolve(dirname(process.execPath), executable),
		executable,
	];
	for (const candidate of candidates) {
		const probe = spawnSync(candidate, ['--skip-infer', '--version'], {
			encoding: 'utf8',
			env: process.env,
		});
		if (probe.status === 0 && !probe.error) {
			return { command: candidate, prefixArgs: ['--skip-infer'] };
		}
	}
	return { command: process.execPath, prefixArgs: ['x', 'turbo'] };
}

const turboCmd = getTurboCommand();

const commands = isPublic
	? [
			{ name: 'coverage', args: ['scripts/check-workspace-lint.ts', '--public'] },
			{ name: 'surfaces', args: ['scripts/run-strict-biome.ts', 'scripts', 'package.json', 'biome.json', 'tsconfig.base.json', 'turbo.json'] },
			{ name: 'turbo', command: turboCmd.command, args: [...turboCmd.prefixArgs, 'run', 'lint'] },
		]
	: [
			{ name: 'coverage', args: ['run', 'lint:workspace-coverage'] },
			{ name: 'turbo', command: turboCmd.command, args: [...turboCmd.prefixArgs, 'run', 'lint', '--output-logs=new-only'] },
			{ name: 'surfaces', args: ['run', 'lint:repository-surfaces'] },
		];

function runParallel({ name, command, args }: { name: string; command?: string; args: string[] }) {
	return new Promise((resolve) => {
		const proc = spawn(command ?? process.execPath, args, {
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

const results = await Promise.all(commands.map(runParallel));

let failed = false;
for (const r of results) {
	const tag = r.status === 0 ? 'ok  ' : 'FAIL';
	console.log(`[${tag}] lint:${r.name}`);
	if (r.stdout) process.stdout.write(r.stdout);
	if (r.stderr) process.stderr.write(r.stderr);
	if (r.status !== 0) failed = true;
}

if (failed) {
	console.error('lint: one or more gates failed');
	process.exit(1);
}
