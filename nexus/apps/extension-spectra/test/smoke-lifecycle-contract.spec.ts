import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const smokeSource = readFileSync(new URL('./smoke.spec.ts', import.meta.url), 'utf8');

describe('SPECTRA smoke lifecycle barriers', () => {
	test('retires the first configured hotkey gesture before reusing the same physical key', () => {
		const acceptedLabel = "'one accepted configured site hotkey'";
		const nextIndependentGesture = "await tapDefaultShortcut(page, 'ArrowRight');";
		const start = smokeSource.indexOf(acceptedLabel);
		const end = smokeSource.indexOf(nextIndependentGesture, start);
		if (start < 0 || end < 0) {
			throw new Error('Configured-site hotkey smoke anchors are missing');
		}

		const retirementWindow = smokeSource.slice(start, end);
		expect(retirementWindow).toContain('await waitForHotkeyFeedbackWindow();');
		expect(retirementWindow).not.toMatch(/setTimeout\([^)]*25/u);
	});
});
