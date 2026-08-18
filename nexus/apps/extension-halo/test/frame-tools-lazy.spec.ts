import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Actions } from '@nexus/contracts';
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

describe('HALO release-admitted lazy all-frame runtime', () => {
	test('keeps the full data-only message vocabulary without admitting every catalog capability', () => {
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

		// Catalog vocabulary is broader than this release executable surface.
		expect(bootstrap).not.toContain('FRAME_TOOL_DOM_SELECTOR_START');
		expect(bootstrap).not.toContain('FRAME_TOOL_ANNOTATE_START');
		expect(runtime).not.toContain('FRAME_TOOL_DOM_SELECTOR_START');
		expect(runtime).not.toContain('FRAME_TOOL_ANNOTATE_START');
	});

	test('keeps only admitted Ruler implementation behind the shared lazy runtime', () => {
		const bootstrap = read('../src/entry/content-frame-tools.ts');
		const runtime = read('../src/entry/content-frame-tools-runtime.ts');

		expect(bootstrap).not.toContain("../content/ruler");
		expect(bootstrap).not.toContain("../content/dom-selector");
		expect(bootstrap).not.toContain("../content/page-annotate");
		expect(bootstrap).toContain("tools/_frame-tools/runtime.js");
		expect(bootstrap).toContain('import(runtimeUrl)');
		expect(bootstrap).toContain('if (!runtimePromise && DEACTIVATION_TYPES.has(type))');

		expect(runtime).toContain("import * as Ruler from '../content/ruler'");
		expect(runtime).not.toContain("../content/dom-selector");
		expect(runtime).not.toContain("../content/page-annotate");
	});

	test('emits only exact admitted lazy runtimes as web-accessible resources', () => {
		const build = read('../build.ts');
		const manifest = readJson('../public/manifest.json');
		const resources = manifest.web_accessible_resources as Array<{
			matches?: string[];
			resources?: string[];
			use_dynamic_url?: boolean;
		}>;

		expect(build).toContain("out: 'tools/_frame-tools/runtime.js', kind: 'module'");
		expect(build).toMatch(/kind === 'module'[\s\S]*format: 'esm'/u);
		expect(resources).toEqual([{
			resources: [
				'tools/_frame-tools/runtime.js',
				'tools/_hover-zoom/runtime.js',
			],
			matches: ['<all_urls>'],
			use_dynamic_url: true,
		}]);
		expect(resources.flatMap((entry) => entry.resources ?? [])).not.toContain('tools/*');
		expect(resources.flatMap((entry) => entry.resources ?? [])).not.toContain('scripts/*');
	});
});
