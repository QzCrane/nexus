import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { canonicalPluginDirectoryNames } from '../../../scripts/registry-gen/discover.ts';
import { parseReleaseAdmission } from '../../../scripts/registry-gen/release-admission.ts';
import { emitGeneratedFile } from '../../../scripts/registry-gen/utils.ts';

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

	test('keeps panel preload authority renderer-neutral and release-admitted', () => {
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

		expect(generator).toContain('hasReleaseSurface');
		expect(generator).toContain('memoizePanelLoader');
		expect(generator).toContain('lazy(generatedToolLoaders');
		expect(generated).toContain('export const generatedToolLoaders');
		expect(generated).toContain("'color-picker': memoizePanelLoader(() => import('../tools/color-picker/panel')");
		expect(generated).toContain("'color-picker': lazy(generatedToolLoaders['color-picker'])");
		expect(generated).toContain("'userscripts': memoizePanelLoader(() => import('../system/userscripts/panel')");
		expect(generated).toContain("import('../tools/pdf/panel')");
		expect(generated).toContain("import('../tools/hash/panel')");
		expect(generated).toContain("import('../tools/clipboard/panel')");
		expect(runtime).toContain('generatedToolLoaders[toolId]()');

		for (const source of [generator, generated, runtime]) {
			expect(source).not.toContain('_payload');
			expect(source).not.toContain('_init');
		}
	});

	test('separates catalog inventory from physical release admission', () => {
		const catalog = readFileSync(
			new URL('../src/kernel/registry/_generated.ts', import.meta.url),
			'utf8',
		);
		const projection = readFileSync(
			new URL('../src/kernel/registry/_generated-release-admission.ts', import.meta.url),
			'utf8',
		);
		const scriptRuntime = readFileSync(
			new URL('../public/script-plugin-runtime.json', import.meta.url),
			'utf8',
		);
		const backgroundProjection = readFileSync(
			new URL('../src/kernel/registry/_generated-background-active.ts', import.meta.url),
			'utf8',
		);

		// Existing functionality remains physically included under an explicit
		// legacy admission without promoting unfinished maturity metadata.
		expect(catalog).toContain("id: 'pdf'");
		expect(projection).toMatch(/RELEASE_ADMITTED_PLUGIN_IDS[\s\S]*"pdf"/u);
		expect(scriptRuntime).toContain('"bilibili-enhancer"');
		expect(scriptRuntime).toContain('"bilibili-plus"');
		expect(backgroundProjection).toContain('"smooth-scroll": true');
		expect(backgroundProjection).toContain('"clipboard"');
		expect(backgroundProjection).toContain('"timer"');
	});

	test('release admission is sorted, unique and rejects ambiguous surface state', () => {
		const current = JSON.parse(readFileSync(
			new URL('../release-admission.json', import.meta.url),
			'utf8',
		));
		expect(() => parseReleaseAdmission(current)).not.toThrow();

		const duplicate = structuredClone(current);
		duplicate.modules.splice(1, 0, structuredClone(duplicate.modules[0]));
		expect(() => parseReleaseAdmission(duplicate)).toThrow(/duplicates|sorted/u);

		const invalid = structuredClone(current);
		invalid.modules[0].surfaces = ['panel', 'panel'];
		expect(() => parseReleaseAdmission(invalid)).toThrow('duplicates a surface');
	});
});
