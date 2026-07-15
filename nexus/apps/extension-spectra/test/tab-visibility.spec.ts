import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	captureStates,
	markTabActivated,
	markTabAudible,
	tabAudioStates,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../src/background/state';
import { recordMediaState, resolveVisibleTabs } from '../src/background/handlers/tab-state';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	tabAudioStates.clear();
	captureStates.clear();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('Chrome-owned visible tab lifecycle', () => {
	test('does not let inactive never-audible media or Capture reports expand the list', async () => {
		installChrome([], []);
		recordMediaState(30, { hasMediaElement: true, userInteracted: true });
		captureStates.set(30, true);

		expect(await resolveVisibleTabs()).toEqual({ tabs: [] });
		expect(tabAudioStates.has(30)).toBe(false);
	});

	test('includes current and bounded recent Chrome activity, then prunes expiry', async () => {
		const now = 1_000_000;
		installChrome([{ id: 1 }], [{ id: 2 }]);
		markTabActivated(3, now - 1_000);
		markTabAudible(4, true, now - 2_000);
		markTabAudible(4, false, now - 500);
		markTabActivated(5, now - TAB_VISIBLE_THRESHOLD_MS - 1);
		recordMediaState(6, { hasMediaElement: true, userInteracted: false });

		expect(await resolveVisibleTabs(now)).toEqual({ tabs: [1, 2, 3, 4] });
		expect(tabAudioStates.has(5)).toBe(false);
		expect(tabAudioStates.has(6)).toBe(false);
	});

	test('ignores a never-audible false Chrome update', () => {
		markTabAudible(42, false, 10);
		expect(tabAudioStates.has(42)).toBe(false);
	});
});

function installChrome(active: Array<{ id: number }>, audible: Array<{ id: number }>): void {
	const query = mock(async (filter: chrome.tabs.QueryInfo) => (
		filter.active ? active : filter.audible ? audible : []
	));
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { tabs: { query } },
	});
}
