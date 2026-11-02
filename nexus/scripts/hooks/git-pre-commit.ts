import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictLintTargets } from './ai-post-write-lint.ts';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = dirname(workspace);

export function preCommitGates(stagedPaths: string[]): string[][] {
	const gates: string[][] = [];
	const scripts = stagedPaths.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(file));
	if (scripts.length > 0) {
		gates.push(['scripts/run-strict-biome.ts', ...strictLintTargets(scripts, repository)]);
	}
	if (stagedPaths.some((file) => file.endsWith('.md'))) gates.push(['run', 'docs:check']);
	return gates;
}

if (import.meta.main) {
	const staged = spawnSync('git', ['diff', '--name-only', '--cached', '--diff-filter=ACMR', '-z'], {
		cwd: repository,
		encoding: 'utf8',
	});
	if (staged.error) throw staged.error;
	if (staged.status !== 0) throw new Error(`Cannot read staged paths: ${staged.stderr}`);
	for (const args of preCommitGates(staged.stdout.split('\0').filter(Boolean))) {
		const result = spawnSync(process.execPath, args, { cwd: workspace, stdio: 'inherit' });
		if (result.error) throw result.error;
		if (result.status !== 0) process.exit(result.status ?? 1);
	}
}
