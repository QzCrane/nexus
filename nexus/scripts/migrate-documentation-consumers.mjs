import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const migrations = [
	{
		file: 'nexus/apps/extension-spectra/test/control-contracts.spec.ts',
		from: "new URL('../docs/control-architecture.md', import.meta.url)",
		to: "new URL('../docs/control/04a-algorithm-matrix.md', import.meta.url)",
		expected: 1,
	},
	{
		file: 'nexus/scripts/verify/check-spectra-control.js',
		from: "path.join(root, APP_PATH, 'docs/control-architecture.md')",
		to: "path.join(root, APP_PATH, 'docs/control/README.md')",
		expected: 1,
	},
	{
		file: 'nexus/scripts/verify/check-spectra-control.js',
		from: 'SCTRL-016: control-architecture.md owner is missing',
		to: 'SCTRL-016: control/README.md owner is missing',
		expected: 1,
	},
	{
		file: 'nexus/scripts/hooks/test.mjs',
		from: 'apps/extension-spectra/docs/control-architecture.md',
		to: 'apps/extension-spectra/docs/control/README.md',
		expected: null,
	},
];

for (const migration of migrations) {
	const filePath = resolve(repositoryRoot, migration.file);
	const current = readFileSync(filePath, 'utf8');
	const count = current.split(migration.from).length - 1;
	if (migration.expected !== null && count !== migration.expected) {
		throw new Error(
			`${migration.file}: expected ${migration.expected} occurrence(s) of ${migration.from}, found ${count}`,
		);
	}
	if (count === 0) continue;
	writeFileSync(filePath, current.replaceAll(migration.from, migration.to));
	console.log(`${migration.file}: ${count} replacement(s)`);
}
