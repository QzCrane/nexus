import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	findReleaseSourceGraphViolations,
} from '../check-release-source-graph';
import {
	RELEASE_CONTENT_SCRIPTS,
	RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES,
} from '../src/kernel/registry/_generated-release-admission';

function text(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('HALO production source graph admission', () => {
	test('reaches no catalog-only tool/script/system implementation from production roots', () => {
		expect(findReleaseSourceGraphViolations()).toEqual([]);
	});

	test('keeps the former Clipboard background leak physically absent', () => {
		const background = text('src/entry/background.ts');
		expect(background).not.toContain("../tools/clipboard/core");
		expect(background).not.toContain('HALO_CLIPBOARD_ADD');
	});

	test('covers literal dynamic imports and CommonJS require as graph edges', () => {
		const source = text('check-release-source-graph.ts');
		expect(source).toContain('ts.SyntaxKind.ImportKeyword');
		expect(source).toContain("node.expression.text === 'require'");
		expect(source).toContain("tools|scripts|system");
		expect(source).toContain('pluginIdentity');
	});

	test('keeps plugin content execution out of the hand-maintained manifest base', () => {
		const base = JSON.parse(text('manifest.base.json')) as {
			content_scripts?: Array<{ js?: string[] }>;
			web_accessible_resources?: unknown;
		};
		expect(base.content_scripts).toEqual([{ 
			matches: ['<all_urls>'],
			js: ['content.js'],
			run_at: 'document_start',
			all_frames: false,
		}]);
		expect(base.web_accessible_resources).toBeUndefined();

		const serialized = JSON.stringify(base);
		for (const entry of RELEASE_CONTENT_SCRIPTS) {
			expect(serialized, entry.id).not.toContain(entry.js);
		}
		for (const runtime of RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES) {
			expect(serialized, runtime.id).not.toContain(runtime.output);
		}
	});

	test('build, release manifest, finalizer and graph roots consume generated release execution metadata', () => {
		const build = text('build.ts');
		const finalizer = text('finalize-release-payload.ts');
		const graph = text('check-release-source-graph.ts');
		const manifestGenerator = text('../../scripts/registry-gen/gen-release-manifest.ts');

		for (const source of [build, finalizer, graph]) {
			expect(source).toContain('RELEASE_CONTENT_SCRIPTS');
			expect(source).toContain('RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES');
		}
		expect(manifestGenerator).toContain('module.contentScript');
		expect(manifestGenerator).toContain('module.webAccessibleRuntimes');

		for (const entry of RELEASE_CONTENT_SCRIPTS) {
			expect(build, `${entry.id}: build must not duplicate generated output`).not.toContain(`'${entry.js}'`);
			expect(graph, `${entry.id}: graph must not duplicate generated output`).not.toContain(`'${entry.js}'`);
		}
		for (const runtime of RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES) {
			expect(build, `${runtime.id}: build must not duplicate generated runtime output`).not.toContain(`'${runtime.output}'`);
			expect(graph, `${runtime.id}: graph must not duplicate generated runtime output`).not.toContain(`'${runtime.output}'`);
		}
	});
});
