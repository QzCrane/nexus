import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('generated browser reports do not become source docs, but an explicit report path is still validated', () => {
	const workspace = resolve(import.meta.dir, '..');
	const directory = mkdtempSync(join(tmpdir(), 'nexus-doc-check-'));
	const generated = join(directory, 'test-results');
	mkdirSync(generated);
	const file = join(generated, 'error-context.md');
	try {
		writeFileSync(file, '# Error\n# Page snapshot\n# Call log\n# Trace\n');
		const run = (args: string[]) => spawnSync(process.execPath, [join(import.meta.dir, 'lint-docs.ts'), '--strict', ...args], {
			cwd: workspace, encoding: 'utf8', shell: false,
		});
		const normal = run(['--path', directory]);
		expect(normal.status, normal.stdout + normal.stderr).toBe(0);
		const explicit = run(['--path', file]);
		expect(explicit.status).toBe(1);
		expect(explicit.stdout + explicit.stderr).toContain('expected exactly one H1');
	} finally {
		rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
});
