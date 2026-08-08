import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { canonicalPluginDirectoryNames } from '../../../scripts/registry-gen/discover.ts';

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
