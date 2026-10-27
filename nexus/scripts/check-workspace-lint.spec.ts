import { describe, expect, test } from 'bun:test';
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseMode,
	portableRepoPath,
	validateBiomeConfig,
	validatePrivateHookSource,
	validateStrictRunnerCommand,
} from './check-workspace-lint.ts';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));

describe('workspace lint path boundary', () => {
	test('keeps the public coverage entrypoint free of static private-sync imports', () => {
		const source = readFileSync(
			resolve(workspaceDir, 'scripts', 'check-workspace-lint.ts'),
			'utf8',
		);
		expect(source).not.toContain("from './sync-public.ts'");
		expect(source).toContain("await import('./sync-public.ts')");
	});

	test('accepts only private or explicit public projection mode', () => {
		expect(parseMode([])).toBe('private');
		expect(parseMode(['--public'])).toBe('public');
		expect(() => parseMode(['--unsafe'])).toThrow('only the optional --public');
		expect(() => parseMode(['--public', 'extra'])).toThrow('only the optional --public');
	});

	test('normalizes repository-owned workspace paths', () => {
		expect(portableRepoPath('apps/extension-halo')).toBe('apps/extension-halo');
		expect(portableRepoPath(resolve(workspaceDir, 'packages', 'contracts'))).toBe(
			'packages/contracts',
		);
	});

	test('rejects the repository root and parent escapes after normalization', () => {
		for (const path of ['', '.', '..', resolve(workspaceDir, '..')]) {
			expect(() => portableRepoPath(path)).toThrow();
		}
	});

	test('rejects absolute paths outside the repository root', () => {
		let outsidePath = resolve(workspaceDir, '..', 'outside-workspace');
		if (process.platform === 'win32') {
			const currentDrive = parse(workspaceDir).root.slice(0, 1).toUpperCase();
			const otherDrive = currentDrive === 'C' ? 'D' : 'C';
			outsidePath = `${otherDrive}:\\outside-workspace`;
		}
		expect(() => portableRepoPath(outsidePath)).toThrow();
	});

	test('rejects workspace paths that resolve through a link outside the root', () => {
		const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'workspace-lint-path-'));
		const repositoryRoot = resolve(fixtureRoot, 'repository');
		const outside = resolve(fixtureRoot, 'outside');
		mkdirSync(repositoryRoot);
		mkdirSync(outside);
		try {
			symlinkSync(
				outside,
				resolve(repositoryRoot, 'linked-outside'),
				process.platform === 'win32' ? 'junction' : 'dir',
			);
			expect(() =>
				portableRepoPath('linked-outside', repositoryRoot),
			).toThrow('resolves outside');
		} finally {
			rmSync(fixtureRoot, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});

	test('requires the unmodified recommended Biome owner', () => {
		const valid = {
			root: true,
			vcs: { enabled: false },
			files: {
				includes: [
					'**',
					'!**/.cache',
					'!**/.playwright-user-data',
					'!**/dist',
					'!**/node_modules',
					'!**/.turbo',
					'!**/assets-backup',
					'!**/build',
					'!**/coverage',
					'!**/playwright-report',
					'!**/release',
					'!**/test-results',
					'!**/vendor',
					'!**/*.md',
				],
			},
			linter: {
				enabled: true,
				rules: { preset: 'recommended' },
			},
		};
		expect(() => validateBiomeConfig(valid)).not.toThrow();
		expect(() =>
			validateBiomeConfig({
				...valid,
				vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true },
			}),
		).toThrow('explicit targets');
		expect(() =>
			validateBiomeConfig({
				...valid,
				linter: {
					...valid.linter,
					rules: {
						preset: 'recommended',
						style: { useImportType: 'off' },
					},
				},
			}),
		).toThrow('without global rule overrides');
		expect(() =>
			validateBiomeConfig({ ...valid, overrides: [] }),
		).toThrow('scope-specific rule overrides');
	});

	test('accepts only one real strict runner command scoped to its workspace', () => {
		const packageDir = resolve(workspaceDir, 'apps', 'extension-halo');
		const valid = 'bun ../../scripts/run-strict-biome.ts .';
		expect(() =>
			validateStrictRunnerCommand(valid, packageDir, 'HALO lint', ['.']),
		).not.toThrow();
		expect(() =>
			validateStrictRunnerCommand(
				`${valid} && echo bypass`,
				packageDir,
				'HALO lint',
			),
		).toThrow('non-composite');
		expect(() =>
			validateStrictRunnerCommand(
				'echo ../../scripts/run-strict-biome.ts src',
				packageDir,
				'HALO lint',
			),
		).toThrow('through Bun');
		expect(() =>
			validateStrictRunnerCommand(
				'bun ../../scripts/run-strict-biome.ts ../extension-spectra/src',
				packageDir,
				'HALO lint',
			),
		).toThrow('escapes its owning workspace');
		expect(() =>
			validateStrictRunnerCommand(
				valid,
				packageDir,
				'HALO lint',
				['src'],
			),
		).toThrow('must lint exactly');
	});

	test('requires one strict staged owner and the complete lint owner before push', () => {
		const valid = [
			'pre-commit:',
			'  commands:',
			'    biome-check:',
			'      run: bun scripts/run-strict-biome.ts {staged_files}',
			'pre-push:',
			'  commands:',
			'    repository-lint:',
			'      run: bun run lint',
			'    dependency-revalidation:',
			'      run: bun --cwd nexus check:dependency-revalidation',
		].join('\n');
		expect(() => validatePrivateHookSource(valid)).not.toThrow();
		expect(() =>
			validatePrivateHookSource(
				valid.replace('bun run lint', 'echo lint'),
			),
		).toThrow('pre-push');
		expect(() =>
			validatePrivateHookSource(
				`${valid}\n    other:\n      run: bunx @biomejs/biome check`,
			),
		).toThrow('staged-file');
		expect(() =>
			validatePrivateHookSource(
				`${valid}\n    other:\n      run: bun x --bun biome check`,
			),
		).toThrow('staged-file');
		expect(() =>
			validatePrivateHookSource(
				`${valid}\n    other:\n      run: bun scripts/run-strict-biome.ts {staged_files}`,
			),
		).toThrow('staged-file');
	});

	test('dependency observation must execute once at the unconditional push boundary', () => {
		const current = readFileSync(resolve(workspaceDir, '../lefthook.yml'), 'utf8');
		expect(() => validatePrivateHookSource(current)).not.toThrow();
		const variants = ['missing', 'misplaced', 'duplicate', 'skipped', 'filtered', 'hook-skipped'];
		for (const variant of variants) {
			const hook = Bun.YAML.parse(current) as Record<string, {
				commands: Record<string, Record<string, unknown>>;
				skip?: unknown;
			}>;
			const commands = hook['pre-push'].commands;
			const command = commands['dependency-revalidation'];
			if (variant === 'missing' || variant === 'misplaced') delete commands['dependency-revalidation'];
			if (variant === 'misplaced') hook['post-merge'].commands['dependency-revalidation'] = command;
			if (variant === 'duplicate') commands['second-lock-check'] = { ...command };
			if (variant === 'skipped') command.skip = true;
			if (variant === 'filtered') command.glob = '*.lock';
			if (variant === 'hook-skipped') hook['pre-push'].skip = true;
			expect(() => validatePrivateHookSource(Bun.YAML.stringify(hook, null, 2))).toThrow('pre-push');
		}
	});
});
