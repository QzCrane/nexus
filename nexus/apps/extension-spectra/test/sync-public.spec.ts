import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	APP_CONFIGS,
	BASE_EXCLUDES,
	PUBLIC_TURBO_CACHE_DIR,
	PUBLIC_VALIDATION_SCRIPTS,
	applicationScriptDependencies,
	assertApplicationScriptDependencies,
	isIncrementalBuildState,
	matchesPattern,
	parseBatchBlobOutput,
	parseArguments,
	parseCommittedTree,
	parseDivergence,
	readCommittedTextFile,
	selectObjectKeys,
	shouldExcludeForConfig,
	shouldExcludeWithPatterns,
	validateDestinationDivergence,
} from '../../../scripts/sync-public.ts';

describe('public repository source projection', () => {
	test('excludes only repository-root scripts while retaining application build scripts', () => {
		expect(matchesPattern('scripts/sync-public.ts', '/scripts')).toBe(true);
		expect(matchesPattern(
			'apps/extension-spectra/scripts/check-production-artifacts.ts',
			'/scripts',
		)).toBe(false);
		expect(shouldExcludeWithPatterns(
			'apps/extension-spectra/scripts/check-production-artifacts.ts',
			[...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes],
		)).toBe(false);
	});

	test('projects the strict lint authority into every public repository', () => {
		for (const config of [APP_CONFIGS.spectra, APP_CONFIGS.halo]) {
			const patterns = [...BASE_EXCLUDES, ...config.excludes];
			expect(config.publicRootFiles).toEqual([
				'scripts/check-workspace-lint.ts',
				'scripts/run-lint-parallel.ts',
				'scripts/run-strict-biome.ts',
			]);
			for (const rootFile of config.publicRootFiles) {
				expect(
					shouldExcludeForConfig(rootFile, patterns, config),
				).toBe(false);
			}
			expect(config.publicRootScriptOverrides.lint).toBe(
				'bun scripts/run-lint-parallel.ts --public',
			);
			expect(config.publicApplicationScriptOverrides.lint).toContain(
				'../../scripts/run-strict-biome.ts',
			);
			expect(config.publicApplicationScriptOverrides.lint).not.toContain(
				'max-diagnostics=100',
			);
		}
	});

	test('keeps an explicit allowlist of application build scripts', () => {
		const patterns = [...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes];
		expect(APP_CONFIGS.spectra.publicApplicationScriptFiles).toEqual([
			'apps/extension-spectra/scripts/check-production-artifacts.ts',
			'apps/extension-spectra/scripts/i18n-assets.ts',
			'apps/extension-spectra/scripts/minification-policy.ts',
		]);
		expect(shouldExcludeForConfig(
			'apps/extension-spectra/scripts/i18n-assets.ts',
			patterns,
			APP_CONFIGS.spectra,
		)).toBe(false);
		for (const relativePath of [
			'apps/extension-spectra/scripts/create-release.ts',
			'apps/extension-spectra/scripts/run-tests.ts',
			'apps/extension-spectra/scripts/smoke-release.ts',
			'apps/extension-spectra/scripts/future-internal-tool.ts',
		]) {
			expect(
				shouldExcludeForConfig(relativePath, patterns, APP_CONFIGS.spectra),
				relativePath,
			).toBe(true);
		}
	});

	test('rejects a build-script dependency outside the audited public allowlist', () => {
		const buildPath = 'apps/extension-spectra/build.ts';
		const buildSource = readFileSync(new URL('../build.ts', import.meta.url), 'utf8');
		expect(applicationScriptDependencies(
			buildPath,
			buildSource,
			APP_CONFIGS.spectra,
		)).toEqual([
			'apps/extension-spectra/scripts/check-production-artifacts.ts',
			'apps/extension-spectra/scripts/i18n-assets.ts',
			'apps/extension-spectra/scripts/minification-policy.ts',
		]);
		expect(() => assertApplicationScriptDependencies(
			buildPath,
			buildSource,
			{
				...APP_CONFIGS.spectra,
				publicApplicationScriptFiles: [],
			},
		)).toThrow('outside the audited allowlist');
		expect(() => assertApplicationScriptDependencies(
			buildPath,
			buildSource,
			APP_CONFIGS.spectra,
		)).not.toThrow();
	});

	test('excludes internal plans, local caches, backup assets, and release output', () => {
		const patterns = [...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes];
		for (const relativePath of [
			'.graph-it/update-check.json',
			'plan.md',
			'apps/extension-spectra/plan.md',
			'apps/extension-spectra/assets/store/icon128.png',
			'apps/extension-spectra/assets-backup/icon.svg',
			'apps/extension-spectra/release/spectra-v1.4.0.zip.sha256',
		]) {
			expect(shouldExcludeWithPatterns(relativePath, patterns), relativePath).toBe(true);
		}
		expect(isIncrementalBuildState('packages/contracts/tsconfig.tsbuildinfo')).toBe(true);
		expect(isIncrementalBuildState('packages/contracts/typecheck.tsbuildinfo')).toBe(true);
		expect(isIncrementalBuildState('packages/contracts/tsconfig.json')).toBe(false);
	});

	test('projects only executable public package scripts', () => {
		const scripts = selectObjectKeys(
			{
				build: 'bun build.ts',
				lint: 'biome check src test',
				test: 'bun test',
				package: 'bun release.ts',
			},
			['build'],
			{ lint: 'biome check src' },
		);
		expect(scripts).toEqual({
			build: 'bun build.ts',
			lint: 'biome check src',
		});
	});

	test('allows amend only for the single unpushed generated commit', () => {
		expect(parseArguments(['spectra'])).toEqual({ targetApp: 'spectra', amend: false });
		expect(parseArguments(['spectra', '--amend'])).toEqual({ targetApp: 'spectra', amend: true });
		expect(parseDivergence('0\t1\n')).toEqual({ behind: 0, ahead: 1 });
		expect(() => validateDestinationDivergence({ behind: 0, ahead: 1 }, true)).not.toThrow();
		expect(() => validateDestinationDivergence({ behind: 0, ahead: 0 }, true)).toThrow();
		expect(() => validateDestinationDivergence({ behind: 0, ahead: 1 }, false)).toThrow();
		expect(() => validateDestinationDivergence({ behind: 1, ahead: 1 }, true)).toThrow();
	});

	test('reads committed blobs in one binary-safe Git batch', () => {
		const firstObjectId = 'a'.repeat(40);
		const secondObjectId = 'b'.repeat(40);
		const firstBlob = Buffer.from([0x61, 0x0a, 0x00, 0x62]);
		const secondBlob = Buffer.from('second');
		const output = Buffer.concat([
			Buffer.from(`${firstObjectId} blob ${firstBlob.length}\n`),
			firstBlob,
			Buffer.from('\n'),
			Buffer.from(`${secondObjectId} blob ${secondBlob.length}\n`),
			secondBlob,
			Buffer.from('\n'),
		]);

		expect(parseBatchBlobOutput(output, [firstObjectId, secondObjectId]).map(
			(blob) => [...blob],
		)).toEqual([[...firstBlob], [...secondBlob]]);
		expect(() => parseBatchBlobOutput(output, [secondObjectId, firstObjectId])).toThrow();
	});

	test('reads committed public modules relative to the source workspace', () => {
		expect(readCommittedTextFile('apps/extension-spectra/build.ts')).toContain(
			'SPECTRA esbuild pipeline',
		);
	});

	test('parses source-relative committed tree records', () => {
		const objectId = 'c'.repeat(40);
		expect(parseCommittedTree(Buffer.from(
			`${objectId}\tblob\tpackage.json\0${objectId}\tblob\tapps/example.ts\0`,
		))).toEqual([
			{ objectId, objectType: 'blob', relativePath: 'package.json' },
			{ objectId, objectType: 'blob', relativePath: 'apps/example.ts' },
		]);
	});

	test('validates every retained public gate with a persistent ignored cache', () => {
		expect(PUBLIC_VALIDATION_SCRIPTS).toEqual(['lint', 'typecheck', 'build']);
		expect(PUBLIC_TURBO_CACHE_DIR).toMatch(/^node_modules\/\.cache\//);
	});

	test('isolates typecheck state from build artifacts via src-only resolution', () => {
		const turbo = JSON.parse(
			readFileSync(new URL('../../../turbo.json', import.meta.url), 'utf8'),
		) as {
			tasks: {
				typecheck: {
					dependsOn: string[];
				};
			};
		};
		expect(turbo.tasks.typecheck.dependsOn).toEqual(['^typecheck']);
		for (const relativePath of [
			'../../../packages/contracts/package.json',
			'../../../packages/nexus-kernel/package.json',
		]) {
			const packageJson = JSON.parse(
				readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
			) as {
				scripts: {
					typecheck: string;
				};
			};
			expect(packageJson.scripts.typecheck).toContain(
				'--tsBuildInfoFile typecheck.tsbuildinfo',
			);
		}
	});
});
