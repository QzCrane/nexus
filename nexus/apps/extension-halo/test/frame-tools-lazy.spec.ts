import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Actions } from '@nexus/contracts';
import { RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES } from '../src/kernel/registry/_generated-release-admission';
import {
	FRAME_TOOL_ANNOTATE_START,
	FRAME_TOOL_ANNOTATE_STOP,
	FRAME_TOOL_DOM_SELECTOR_START,
	FRAME_TOOL_DOM_SELECTOR_STOP,
	FRAME_TOOL_RULER_CANCEL,
	FRAME_TOOL_RULER_START,
} from '../src/content/frame-tool-messages';

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function readJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

describe('HALO lazy all-frame tool runtime', () => {
	test('keeps one data-only frame-tool message authority without pulling global contracts into startup', () => {
		const authority = read('../src/content/frame-tool-messages.ts');
		const bootstrap = read('../src/entry/content-frame-tools.ts');
		const runtime = read('../src/entry/content-frame-tools-runtime.ts');

		expect(FRAME_TOOL_RULER_START).toBe(Actions.HALO_RULER_START);
		expect(FRAME_TOOL_RULER_CANCEL).toBe(Actions.HALO_RULER_CANCEL);
		expect([
			FRAME_TOOL_RULER_START,
			FRAME_TOOL_RULER_CANCEL,
			FRAME_TOOL_DOM_SELECTOR_START,
			FRAME_TOOL_DOM_SELECTOR_STOP,
			FRAME_TOOL_ANNOTATE_START,
			FRAME_TOOL_ANNOTATE_STOP,
		]).toEqual([
			'HALO_RULER_START',
			'HALO_RULER_CANCEL',
			'HALO_DOM_SELECTOR_START',
			'HALO_DOM_SELECTOR_STOP',
			'HALO_ANNOTATE_START',
			'HALO_ANNOTATE_STOP',
		]);
		expect(authority).not.toMatch(/addEventListener|onMessage|setTimeout|setInterval|MutationObserver/u);
		expect(bootstrap).not.toContain('@nexus/contracts');
		expect(runtime).not.toContain('@nexus/contracts');
		expect(bootstrap).toContain("from '../content/frame-tool-messages'");
		expect(runtime).toContain("from '../content/frame-tool-messages'");
	});

	test('keeps heavy frame-tool implementations out of the static all-frame bootstrap', () => {
		const bootstrap = read('../src/entry/content-frame-tools.ts');
		const runtime = read('../src/entry/content-frame-tools-runtime.ts');

		expect(bootstrap).not.toContain("../content/ruler");
		expect(bootstrap).not.toContain("../content/dom-selector");
		expect(bootstrap).not.toContain("../content/page-annotate");
		expect(bootstrap).toContain("tools/_frame-tools/runtime.js");
		expect(bootstrap).toContain('import(runtimeUrl)');
		expect(bootstrap).toContain('if (!runtimePromise && DEACTIVATION_TYPES.has(type))');

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
		const toolsResource = resources.find((entry) => entry.resources?.includes('tools/_frame-tools/runtime.js'));

		expect(RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES).toContainEqual({ id: 'ruler', entry: 'src/entry/content-frame-tools-runtime.ts', output: 'tools/_frame-tools/runtime.js' });
		expect(build).toMatch(/kind === 'module'[\s\S]*format: 'esm'/u);
		expect(toolsResource).toMatchObject({
			matches: ['<all_urls>'],
			use_dynamic_url: true,
		});
	});
});
