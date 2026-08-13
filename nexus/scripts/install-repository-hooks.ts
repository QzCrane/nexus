// goal: bind Git to checked-in fail-closed hook launchers
// inv: a missing Lefthook/Bun runtime blocks the hook instead of reporting success

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
	encoding: 'utf8',
	shell: false,
});
if (top.status !== 0 || !top.stdout.trim()) {
	throw new Error(`Unable to resolve repository root: ${top.stderr.trim()}`);
}
const repository = top.stdout.trim();
for (const hook of ['pre-commit', 'commit-msg', 'pre-push', 'post-merge']) {
	if (!existsSync(resolve(repository, '.githooks', hook))) {
		throw new Error(`Missing checked-in Git hook: ${hook}`);
	}
}
const configured = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
	cwd: repository,
	encoding: 'utf8',
	shell: false,
});
if (configured.status !== 0) {
	throw new Error(`Unable to configure repository hooks: ${configured.stderr.trim()}`);
}
console.log('✓ Git hooks: checked-in fail-closed launchers active');
