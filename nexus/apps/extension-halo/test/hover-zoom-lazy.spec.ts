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

	test('preserves pending same-target mouseout without rerunning trigger validation', () => {
		const onOut = sourceWindow(eventHost, 'export function createOnOut', '/** Handle mousemove');
		const pendingGuard = 'if (isPendingPreviewTransition(related)) return;';
		const retireIntent = 'cancelPendingPreviewIntent();';
		expect(onOut).toContain(pendingGuard);
		expect(onOut).toContain(retireIntent);
		expect(onOut.indexOf(pendingGuard)).toBeLessThan(onOut.indexOf(retireIntent));
		expect(onOut).not.toContain('findTriggerElement(');
		expect(runtimeLoader).toContain('let pendingPreviewTarget: HTMLElement | null = null;');
		expect(runtimeLoader).toContain('pending.contains(related)');
		expect(runtimeLoader).toContain('related.contains(pending)');
	});

	test('keeps pending ownership through the heavy runtime handoff', () => {
		const request = sourceWindow(runtimeLoader, 'export async function requestPreview', '\n}\n');
		expect(request).toContain('await runtime.tryTrigger(state, preload, target);');
		expect(request).toContain('finally {');
		expect(request).toContain('pendingPreviewTarget === target');
	});

	test('retires stale mousemove debounce before publishing a new keyboard gesture', () => {
		const gesture = sourceWindow(
			keyHost,
			'// Check if this keydown creates a valid hotkey combo',
			'// If mouse position unknown',
		);
		const clearDebounce = 'clearTriggerTimer();';
		const publishModifiers = 'state.modifiersActive = true;';
		expect(gesture).toContain(clearDebounce);
		expect(gesture).toContain(publishModifiers);
		expect(gesture.indexOf(clearDebounce)).toBeLessThan(gesture.indexOf(publishModifiers));
	});

	test('keeps synchronous Alt ownership in both light key phases', () => {
		const keydown = sourceWindow(keyHost, 'export function createOnKeyDown', '/** Handle keyup');
		const keyup = sourceWindow(keyHost, 'export function createOnKeyUp', '\n}\n');

		expect(keydown).toContain("e.key === 'Alt' && state.settings.altKeyMode === 'block'");
		expect(keydown).toContain('e.preventDefault();');
		expect(keydown).toContain('void requestPreview(state, preload, trigger);');
		expect(keyup).toContain("e.key === 'Alt'");
		expect(keyup).toContain("state.settings.altKeyMode === 'block'");
		expect(keyup).toContain('e.preventDefault();');
	});
});
