import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function sourceWindow(text: string, startAnchor: string, endAnchor: string): string {
	const start = text.indexOf(startAnchor);
	const end = text.indexOf(endAnchor, start);
	if (start < 0 || end < 0) throw new Error(`Missing source window: ${startAnchor} -> ${endAnchor}`);
	return text.slice(start, end);
}

const contentHost = source('src/content/hover-zoom.ts');
const eventHost = source('src/content/hover-zoom-events.ts');
const keyHost = source('src/content/hover-zoom-keys.ts');
const runtimeLoader = source('src/content/hover-zoom-runtime-loader.ts');
const runtimeEntry = source('src/entry/content-hover-zoom-runtime.ts');
const buildSource = source('build.ts');

describe('HALO Hover Zoom lazy preview runtime', () => {
	test('keeps resolver and viewer code outside the static document_idle host', () => {
		expect(contentHost).not.toContain("content/resolvers/rule-resolver");
		expect(eventHost).not.toContain("'./hover-zoom-actions'");
		expect(keyHost).not.toContain("'./hover-zoom-actions'");
		expect(runtimeEntry).toContain("export { tryTrigger } from '../content/hover-zoom-actions';");
	});

	test('loads one packaged ESM runtime and retries after a failed import', () => {
		expect(runtimeLoader).toContain("const RUNTIME_PATH = 'tools/_hover-zoom/runtime.js';");
		expect(runtimeLoader).toContain('chrome.runtime.getURL(RUNTIME_PATH)');
		expect(runtimeLoader).toContain('import(runtimeUrl)');
		expect(runtimeLoader).toContain('if (runtimePromise) return runtimePromise;');
		expect(runtimeLoader).toContain('if (runtimePromise === pending) runtimePromise = null;');
		expect(buildSource).toContain(
			"{ entry: 'src/entry/content-hover-zoom-runtime.ts', out: 'tools/_hover-zoom/runtime.js', kind: 'module' }",
		);
	});

	test('retires an in-flight preview when input or settings authority changes', () => {
		expect(runtimeLoader).toContain('const revision = ++previewIntentRevision;');
		expect(runtimeLoader).toContain('revision !== previewIntentRevision');
		expect(runtimeLoader).toContain('!state.settings.enabled');
		expect(runtimeLoader).toContain('!state.modifiersActive');
		expect(runtimeLoader).toContain('!target.isConnected');
		expect(keyHost).toContain('cancelPendingPreviewIntent();');
		expect(eventHost).toContain('cancelPendingPreviewIntent();');
		expect(contentHost).toContain('cancelPendingPreviewIntent();');
	});

	test('does not retire a pending import for mouseout inside one logical trigger', () => {
		const onOut = sourceWindow(eventHost, 'export function createOnOut', '/** Handle mousemove');
		const sameTriggerGuard = 'if (sourceTrigger && relatedTrigger === sourceTrigger) return;';
		const retireIntent = 'cancelPendingPreviewIntent();';
		expect(onOut).toContain(sameTriggerGuard);
		expect(onOut).toContain(retireIntent);
		expect(onOut.indexOf(sameTriggerGuard)).toBeLessThan(onOut.indexOf(retireIntent));
	});

	test('keeps synchronous Alt ownership in the light key handler', () => {
		expect(keyHost).toContain("e.key === 'Alt' && state.settings.altKeyMode === 'block'");
		expect(keyHost).toContain('e.preventDefault();');
		expect(keyHost).toContain('void requestPreview(state, preload, trigger);');
	});
});
