import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { canonicalPluginDirectoryNames } from '../../../scripts/registry-gen/discover.ts';
import { emitGeneratedFile } from '../../../scripts/registry-gen/utils.ts';
import {
	isReleaseAdmitted,
	normalizeReleaseStatus,
} from '../src/kernel/registry/release-admission';

describe('HALO registry generation', () => {
	test('canonicalizes filesystem discovery order before generating artifacts', () => {
		const discovered = ['zeta', 'api-tester', 'hover-zoom', 'base64', 'bilibili-plus'];
		expect(canonicalPluginDirectoryNames(discovered)).toEqual([
			'api-tester',
			'base64',
			'bilibili-plus',
			'hover-zoom',
			'zeta',
		]);
		expect(discovered).toEqual(['zeta', 'api-tester', 'hover-zoom', 'base64', 'bilibili-plus']);
	});

	test('check mode is read-only and rejects generated drift', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'halo-registry-check-'));
		const output = resolve(directory, 'projection.ts');
		try {
			emitGeneratedFile(output, 'canonical\n', 'write', 'fixture');
			emitGeneratedFile(output, 'canonical\n', 'check', 'fixture');
			writeFileSync(output, 'drift\n');
			expect(() => emitGeneratedFile(output, 'canonical\n', 'check', 'fixture'))
				.toThrow('generated projection is stale');
			expect(readFileSync(output, 'utf8')).toBe('drift\n');
		} finally {
			rmSync(directory, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});

	test('publishes real release identity and never source-folder size as module metadata', () => {
		const generated = readFileSync(
			new URL('../src/kernel/registry/_generated.ts', import.meta.url),
			'utf8',
		);
		const sourceManifest = JSON.parse(readFileSync(
			new URL('../public/manifest.json', import.meta.url),
			'utf8',
		)) as { version: string };
		expect(generated).toContain(`export const HALO_RELEASE_VERSION = '${sourceManifest.version}'`);
		expect(generated).toContain(`version: '${sourceManifest.version}'`);
		expect(generated).toContain("distribution: 'bundled'");
		expect(generated).not.toMatch(/\n\s*size:\s*\d+/u);
		expect(generated).not.toContain("version: '1.0.0'");
	});

	test('separates product release status from module enablement', () => {
		// Missing status historically shipped. Preserve compatibility until every
		// legacy manifest is explicitly migrated, but never let builtIn/optional
		// enablement rewrite an explicit product status again.
		expect(normalizeReleaseStatus(undefined)).toBe('ready');
		expect(isReleaseAdmitted(undefined)).toBe(true);
		expect(isReleaseAdmitted('ready')).toBe(true);
		expect(isReleaseAdmitted('beta')).toBe(true);
		expect(isReleaseAdmitted('coming')).toBe(false);
		expect(isReleaseAdmitted('disabled')).toBe(false);
		expect(() => normalizeReleaseStatus('available')).toThrow('invalid HALO release status');
	});

	test('keeps catalog-only panels out of the production import graph', () => {
		const generated = readFileSync(
			new URL('../src/components/_generated-tool-loader.ts', import.meta.url),
			'utf8',
		);
		const catalogOnlyIds = [
			'archive',
			'base64',
			'clipboard',
			'pdf',
			'regex',
			'screenshot',
			'sticky-notes',
			'timer',
		];
		for (const id of catalogOnlyIds) {
			expect(generated).not.toContain(`'${id}': memoizePanelLoader`);
			expect(generated).not.toContain(`'${id}': lazy(`);
		}
		// Legacy implicit-ready modules remain present until their manifests are
		// explicitly classified, avoiding an accidental product-removal migration.
		expect(generated).toContain("'hash': memoizePanelLoader(() => import('../tools/hash/panel')");
	});

	test('keeps catalog-only background profiles out of startup projection', () => {
		const projection = readFileSync(
			new URL('../src/kernel/registry/_generated-background-active.ts', import.meta.url),
			'utf8',
		);
		expect(projection).not.toContain('"clipboard"');
		expect(projection).not.toContain('"timer"');
		expect(projection).toContain('"hover-zoom"');
	});

	test('exposes only the two page-loaded packaged runtimes to web origins', () => {
		const manifest = JSON.parse(readFileSync(
			new URL('../public/manifest.json', import.meta.url),
			'utf8',
		)) as {
			web_accessible_resources?: Array<{ resources?: string[]; matches?: string[]; use_dynamic_url?: boolean }>;
		};
		expect(manifest.web_accessible_resources).toEqual([{
			resources: [
				'tools/_frame-tools/runtime.js',
				'tools/_hover-zoom/runtime.js',
			],
			matches: ['<all_urls>'],
			use_dynamic_url: true,
		}]);
	});

	test('keeps panel preload authority renderer-neutral', () => {
		const generator = readFileSync(
			new URL('../../../scripts/registry-gen/gen-loader.ts', import.meta.url),
			'utf8',
		);
		const generated = readFileSync(
			new URL('../src/components/_generated-tool-loader.ts', import.meta.url),
			'utf8',
		);
		const runtime = readFileSync(
			new URL('../src/components/core/lazy-tool-loader.tsx', import.meta.url),
			'utf8',
		);

		expect(generator).toContain('export const generatedToolLoaders');
		expect(generator).toContain('memoizePanelLoader');
		expect(generator).toContain('lazy(generatedToolLoaders');
		expect(generated).toContain('export const generatedToolLoaders');
		expect(generated).toContain("'hash': memoizePanelLoader(() => import('../tools/hash/panel')");
		expect(generated).toContain("'hash': lazy(generatedToolLoaders.hash)");
		expect(runtime).toContain('generatedToolLoaders[toolId]()');

		for (const source of [generator, generated, runtime]) {
			expect(source).not.toContain('_payload');
			expect(source).not.toContain('_init');
		}
	});
});
