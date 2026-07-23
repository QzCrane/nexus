import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	APP_CONFIGS,
	BASE_EXCLUDES,
	matchesPattern,
	parseArguments,
	parseDivergence,
	selectObjectKeys,
	shouldExcludeForConfig,
	shouldExcludeWithPatterns,
	validateDestinationDivergence,
} = require('../../../scripts/sync-public.cjs') as {
	APP_CONFIGS: Record<string, {
		excludes: string[];
		publicApplicationScriptFiles: string[];
	}>;
	BASE_EXCLUDES: string[];
	matchesPattern(relativePath: string, pattern: string): boolean;
	parseArguments(args: string[]): { targetApp: string; amend: boolean };
	parseDivergence(output: string): { behind: number; ahead: number };
	selectObjectKeys(
		source: Record<string, string>,
		allowedKeys: string[],
		overrides?: Record<string, string>,
	): Record<string, string>;
	shouldExcludeForConfig(
		relativePath: string,
		patterns: string[],
		config: {
			applicationPath: string;
			publicApplicationScriptFiles: string[];
		},
	): boolean;
	shouldExcludeWithPatterns(relativePath: string, patterns: string[]): boolean;
	validateDestinationDivergence(
		divergence: { behind: number; ahead: number },
		shouldAmend: boolean,
	): void;
};

describe('public repository source projection', () => {
	test('excludes only repository-root scripts while retaining application build scripts', () => {
		expect(matchesPattern('scripts/sync-public.cjs', '/scripts')).toBe(true);
		expect(matchesPattern(
			'apps/extension-spectra/scripts/check-production-artifacts.mjs',
			'/scripts',
		)).toBe(false);
		expect(shouldExcludeWithPatterns(
			'apps/extension-spectra/scripts/check-production-artifacts.mjs',
			[...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes],
		)).toBe(false);
	});

	test('keeps an explicit allowlist of application build scripts', () => {
		const patterns = [...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes];
		expect(APP_CONFIGS.spectra.publicApplicationScriptFiles).toEqual([
			'apps/extension-spectra/scripts/check-production-artifacts.mjs',
			'apps/extension-spectra/scripts/chrome120-webrtc-adapter.mjs',
			'apps/extension-spectra/scripts/external-boundary-properties.mjs',
			'apps/extension-spectra/scripts/i18n-assets.ts',
		]);
		expect(shouldExcludeForConfig(
			'apps/extension-spectra/scripts/i18n-assets.ts',
			patterns,
			APP_CONFIGS.spectra,
		)).toBe(false);
		for (const relativePath of [
			'apps/extension-spectra/scripts/create-release.mjs',
			'apps/extension-spectra/scripts/run-tests.mjs',
			'apps/extension-spectra/scripts/smoke-release.mjs',
			'apps/extension-spectra/scripts/future-internal-tool.mjs',
		]) {
			expect(
				shouldExcludeForConfig(relativePath, patterns, APP_CONFIGS.spectra),
				relativePath,
			).toBe(true);
		}
	});

	test('excludes internal plans, local caches, backup assets, and release output', () => {
		const patterns = [...BASE_EXCLUDES, ...APP_CONFIGS.spectra.excludes];
		for (const relativePath of [
			'.graph-it/update-check.json',
			'plan.md',
			'apps/extension-spectra/plan.md',
			'apps/extension-spectra/assets/store/icon128.png',
			'apps/extension-spectra/assets-backup/icon.svg',
			'apps/extension-spectra/debug_run.mjs',
			'apps/extension-spectra/release/spectra-v1.4.0.zip.sha256',
		]) {
			expect(shouldExcludeWithPatterns(relativePath, patterns), relativePath).toBe(true);
		}
	});

	test('projects only executable public package scripts', () => {
		const scripts = selectObjectKeys(
			{
				build: 'bun build.mjs',
				lint: 'biome check src test',
				test: 'bun test',
				package: 'bun release.mjs',
			},
			['build'],
			{ lint: 'biome check src' },
		);
		expect(scripts).toEqual({
			build: 'bun build.mjs',
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
});
