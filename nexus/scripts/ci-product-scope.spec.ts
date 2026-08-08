import { describe, expect, test } from 'bun:test';
import {
	classifyChangedPaths,
	isDocumentationOnlyPath,
	parseNulSeparatedPaths,
} from './ci-product-scope.mjs';

describe('CI product scope classifier', () => {
	test('always runs both products outside pull requests', () => {
		for (const eventName of ['push', 'workflow_dispatch']) {
			expect(classifyChangedPaths([], eventName)).toEqual({
				spectra: true,
				halo: true,
				reason: 'non-pr',
			});
		}
	});

	test('fails closed when a pull-request diff is unexpectedly empty', () => {
		expect(classifyChangedPaths([], 'pull_request')).toEqual({
			spectra: true,
			halo: true,
			reason: 'empty-diff',
		});
	});

	test('scopes SPECTRA extension and root remote-site changes to SPECTRA', () => {
		for (const path of [
			'nexus/apps/extension-spectra/src/content/core/index.ts',
			'remote-site/index.html',
			'remote-site/vendor/peerjs.min.js',
		]) {
			const result = classifyChangedPaths([path], 'pull_request');
			expect(result.spectra).toBe(true);
			expect(result.halo).toBe(false);
		}
	});

	test('scopes HALO changes including normalized Unicode paths to HALO', () => {
		const result = classifyChangedPaths([
			'nexus/apps/extension-halo/src/tools/示例/panel.tsx',
		], 'pull_request');
		expect(result.spectra).toBe(false);
		expect(result.halo).toBe(true);
	});

	test('combines independently owned product paths', () => {
		expect(classifyChangedPaths([
			'nexus/apps/extension-spectra/src/index.ts',
			'nexus/apps/extension-halo/src/index.ts',
		], 'pull_request')).toMatchObject({ spectra: true, halo: true });
	});

	test('treats cross-product rename sides as affecting both products', () => {
		expect(classifyChangedPaths([
			'nexus/apps/extension-spectra/src/old.ts',
			'nexus/apps/extension-halo/src/new.ts',
		], 'pull_request')).toMatchObject({ spectra: true, halo: true });
	});

	test('allows only explicit documentation paths to skip both product matrices', () => {
		for (const path of [
			'docs/architecture.md',
			'nexus/docs/工程.md',
			'README.md',
			'AGENTS.md',
		]) expect(isDocumentationOnlyPath(path)).toBe(true);
		expect(classifyChangedPaths([
			'docs/architecture.md',
			'nexus/docs/工程.md',
			'README.md',
		], 'pull_request')).toMatchObject({ spectra: false, halo: false, reason: 'docs-only' });
	});

	test('fails closed to both for shared, toolchain, workflow, unknown app, and future root paths', () => {
		for (const path of [
			'nexus/packages/contracts/src/index.ts',
			'nexus/scripts/check-toolchain.ts',
			'nexus/turbo.json',
			'nexus/bun.lock',
			'.github/workflows/cross-platform.yml',
			'nexus/apps/future-product/src/index.ts',
			'future-root-surface.bin',
		]) {
			const result = classifyChangedPaths([path], 'pull_request');
			expect(result.spectra).toBe(true);
			expect(result.halo).toBe(true);
			expect(result.reason.startsWith('shared-or-unknown:')).toBe(true);
		}
	});

	test('a shared path dominates otherwise product-only or docs-only changes', () => {
		expect(classifyChangedPaths([
			'nexus/apps/extension-halo/src/index.ts',
			'docs/readme.md',
			'nexus/packages/ui-kit/src/index.ts',
		], 'pull_request')).toMatchObject({ spectra: true, halo: true });
	});
});

describe('NUL-delimited Git path transport', () => {
	test('preserves spaces and Unicode without Git C-style quoting', () => {
		const paths = [
			'nexus/apps/extension-halo/src/工具 文件.ts',
			'remote-site/assets/peer js.js',
		];
		expect(parseNulSeparatedPaths(Buffer.from(`${paths.join('\0')}\0`))).toEqual(paths);
	});

	test('accepts an empty byte stream as an empty candidate and rejects interior empty records', () => {
		expect(parseNulSeparatedPaths(Buffer.alloc(0))).toEqual([]);
		expect(() => parseNulSeparatedPaths(Buffer.from('a\0\0b\0'))).toThrow(
			'Changed-path stream contains an empty record',
		);
	});

	test('rejects malformed UTF-8 instead of accidentally classifying replacement text as docs-only', () => {
		const malformed = Buffer.concat([
			Buffer.from('docs/'),
			Buffer.from([0xff]),
			Buffer.from('.md\0'),
		]);
		expect(() => parseNulSeparatedPaths(malformed)).toThrow(
			'Changed-path stream is not valid UTF-8',
		);
	});
});
