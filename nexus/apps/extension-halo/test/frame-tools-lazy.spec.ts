import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function readJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

describe('HALO lazy all-frame tool runtime', () => {
	test('keeps heavy frame-tool implementations out of the static all-frame bootstrap', () => {
		const bootstrap = read('../src/entry/content-frame-tools.ts');
		const runtime = read('../src/entry/content-frame-tools-runtime.ts');

		expect(bootstrap).not.toContain('@nexus/contracts');
		expect(bootstrap).not.toContain("../content/ruler");
		expect(bootstrap).not.toContain("../content/dom-selector");
		expect(bootstrap).not.toContain("../content/page-annotate");
		expect(bootstrap).toContain("tools/_frame-tools/runtime.js");
		expect(bootstrap).toContain('import(runtimeUrl)');
		expect(bootstrap).toContain('if (!runtimePromise && DEACTIVATION_TYPES.has(message.type))');

		expect(runtime).toContain("import * as Ruler from '../content/ruler'");
		expect(runtime).toContain("import * as DomSelector from '../content/dom-selector'");
		expect(runtime).toContain("import * as PageAnnotate from '../content/page-annotate'");
	});

	test('emits the lazy runtime as ESM under the existing tools web-accessible domain', () => {
		const build = read('../build.ts');
		const manifest = readJson('../public/manifest.json');
		const resources = manifest.web_accessible_resources as Array<{
			matches?: string[];
			resources?: string[];
			use_dynamic_url?: boolean;
		}>;
		const toolsResource = resources.find((entry) => entry.resources?.includes('tools/*'));

		expect(build).toContain("out: 'tools/_frame-tools/runtime.js', kind: 'module'");
		expect(build).toMatch(/kind === 'module'[\s\S]*format: 'esm'/u);
		expect(toolsResource).toMatchObject({
			matches: ['<all_urls>'],
			use_dynamic_url: true,
		});
	});
});
