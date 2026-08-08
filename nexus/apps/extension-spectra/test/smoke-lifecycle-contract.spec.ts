import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const smokeSource = readFileSync(new URL('./smoke.spec.ts', import.meta.url), 'utf8');

function sourceWindow(startAnchor: string, endAnchor: string): string {
	const start = smokeSource.indexOf(startAnchor);
	const end = smokeSource.indexOf(endAnchor, start);
	if (start < 0 || end < 0) {
		throw new Error(`SPECTRA smoke lifecycle anchors are missing: ${startAnchor} -> ${endAnchor}`);
	}
	return smokeSource.slice(start, end);
}

function expectLifecycleBarrier(window: string): void {
	expect(window).toContain('await waitForHotkeyFeedbackWindow();');
	expect(window).not.toMatch(/setTimeout\([^)]*25/u);
}

describe('SPECTRA smoke lifecycle barriers', () => {
	test('retires the first configured hotkey gesture before the next independent shortcut', () => {
		expectLifecycleBarrier(sourceWindow(
			"'one accepted configured site hotkey'",
			"await tapDefaultShortcut(page, 'ArrowRight');",
		));
	});

	test('retires the default shortcut transaction before reusing configured KeyK as a held gesture', () => {
		expectLifecycleBarrier(sourceWindow(
			"'one default hotkey despite a colliding site binding'",
			"await setMode('window-keyup-stop');",
		));
	});
});
