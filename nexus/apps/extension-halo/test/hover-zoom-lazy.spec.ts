import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectResourcePreference } from '../src/tools/hover-zoom/content/utils/resource-key-helper';

function source(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('Hover Zoom interaction-gated runtime', () => {
	test('keeps the manifest entry on a minimal bootstrap and the heavy implementation behind packaged ESM', () => {
		const entry = source('../src/entry/content-hover-zoom.ts');
		const bootstrap = source('../src/content/hover-zoom-bootstrap.ts');
		const runtimeEntry = source('../src/entry/content-hover-zoom-runtime.ts');
		const build = source('../build.ts');

		expect(entry).toContain("import { initHoverZoomBootstrap } from '../content/hover-zoom-bootstrap'");
		expect(entry).not.toContain("from '../content/hover-zoom'");
		expect(bootstrap).toContain("const RUNTIME_PATH = 'tools/_hover-zoom/runtime.js'");
		expect(bootstrap).toContain('import(chrome.runtime.getURL(RUNTIME_PATH))');
		expect(bootstrap).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"]\.\/hover-zoom['"]/s);
		expect(runtimeEntry).toContain("export { init } from '../content/hover-zoom'");
		expect(build).toContain("out: 'tools/_hover-zoom/runtime.js', kind: 'module'");
	});

	test('does not turn default enabled storage hydration into an immediate heavy import', () => {
		const bootstrap = source('../src/content/hover-zoom-bootstrap.ts');
		const hydrationStart = bootstrap.indexOf('chrome.storage.local.get(STORAGE_KEY)');
		const storageListener = bootstrap.indexOf('chrome.storage.onChanged.addListener');
		const hydration = bootstrap.slice(hydrationStart, storageListener);

		expect(hydrationStart).toBeGreaterThanOrEqual(0);
		expect(storageListener).toBeGreaterThan(hydrationStart);
		expect(hydration).not.toContain('requestActivation()');
		expect(bootstrap).toContain('if (inputAttached || runtime || !settings.enabled) return;');
	});

	test('preserves exact resource-key matching for plain first-interaction snapshots', () => {
		const keys = {
			imageKey: { shift: false, ctrl: false, alt: true },
			videoKey: { shift: false, ctrl: true, alt: true },
		};
		expect(detectResourcePreference(keys, { shiftKey: false, ctrlKey: false, altKey: true })).toBe('image');
		expect(detectResourcePreference(keys, { shiftKey: false, ctrlKey: true, altKey: true })).toBe('video');
		expect(detectResourcePreference(keys, { shiftKey: false, ctrlKey: true, altKey: false })).toBeNull();
	});

	test('keeps synchronous Alt block ownership in the bootstrap before async activation', () => {
		const bootstrap = source('../src/content/hover-zoom-bootstrap.ts');
		const keydownStart = bootstrap.indexOf('function onKeyDown');
		const keydownEnd = bootstrap.indexOf('function onKeyUp', keydownStart);
		const keydown = bootstrap.slice(keydownStart, keydownEnd);

		expect(keydown).toContain("settings.altKeyMode === 'block'");
		expect(keydown).toContain('event.preventDefault()');
		expect(keydown.indexOf('event.preventDefault()')).toBeLessThan(keydown.indexOf('requestActivation()'));
	});
});
