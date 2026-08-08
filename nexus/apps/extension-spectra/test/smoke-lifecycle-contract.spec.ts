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
	test('defines feedback retirement as one complete visible-to-hidden OSD window', () => {
		const helper = sourceWindow(
			'const waitForHotkeyFeedbackWindow',
			'const tapSiteHotkey',
		);
		expect(helper.match(/page\.waitForFunction/g)).toHaveLength(2);
		expect(helper).toContain("osd?.classList.contains('v') === true");
		expect(helper).toContain("!osd.classList.contains('v')");
	});

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
