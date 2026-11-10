// goal: local gesture feedback shares the palette while the badge projects actuals
import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, type VolumeTone } from '@nexus/contracts';
import { gestureVolumeTone } from '../src/popup/card/render';
import { resolveHotkeyVolumeTone, type HotkeyVolumeToneFacts } from '../src/content/ui/hotkey-volume-tone';
import { resetPaintedBadgesForTests, updateBadgeFromControlProjection } from '../src/background/handlers/badge';
import { badgeState } from '../src/background/state';
import { resetBadgeUsageForTests } from '../src/background/badge-usage';
import { subscribePopupTabUiEvents } from '../src/popup/ui-event-hub';

const TAB_ID = 7_931;
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	badgeState.clear();
	resetPaintedBadgesForTests();
	resetBadgeUsageForTests();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

type Snapshot = NonNullable<Parameters<typeof gestureVolumeTone>[0]['controlSnapshot']>;
const snapshotWith = (
	strategy: 'dom-native' | 'page-native',
	boostStrategy?: 'capture' | 'media-webaudio',
): Snapshot => ({
	tabId: TAB_ID, documentId: 'doc', origin: 'https://live.example',
	generation: 1, revision: 1, activeMedia: null, activeVideo: null,
	fields: {
		volumeBase: { phase: 'applied', strategy, actual: 100, revision: 1, controlled: true, lastError: null },
		...(boostStrategy ? { boost: {
			phase: 'applied', strategy: boostStrategy, actual: 1.1, revision: 1, controlled: true, lastError: null,
		} } : {}),
	},
} as unknown as Snapshot);

const factsWith = (volume: number, overrides: Partial<HotkeyVolumeToneFacts> = {}): HotkeyVolumeToneFacts => ({
	volume, muted: false, enabled: true, actualMode: 'bypass', phase: 'idle', boostRoute: undefined, ...overrides,
});

describe('volume presentation boundaries', () => {
	test.each(['capture', 'media-webaudio', null] as const)('Popup and local OSD share the first policy candidate (%s)', (prospectiveBoostRoute) => {
		for (const volume of [0, 40, 100, 110, 350]) {
			const popup = gestureVolumeTone({ muted: false, volume, enabled: true,
				actualMode: 'bypass', phase: 'idle',
				controlSnapshot: { ...snapshotWith('dom-native'), prospectiveBoostRoute },
			});
			const osd = resolveHotkeyVolumeTone(factsWith(volume, { prospectiveBoostRoute }));
			expect(osd).toBe(popup);
			expect(popup).toBe(volume === 0 ? 'muted' : volume > 100 && prospectiveBoostRoute === 'capture' ? 'capture' : 'native');
		}
	});

	test('legacy hotkey stage broadcasts cannot enter the guarded card event channel', () => {
		let listener: ((message: unknown, sender: chrome.runtime.MessageSender) => false) | undefined;
		let calls = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-self',
			onMessage: { addListener: (value: typeof listener) => { listener = value; }, removeListener: () => undefined },
		} } });
		const unsubscribe = subscribePopupTabUiEvents(TAB_ID, () => { calls += 1; });
		try {
			for (const kind of ['spectra.badge.hotkey.stage', 'spectra.popup.hotkey.tone']) {
				listener?.({ kind, tabId: TAB_ID, volume: 350, tone: 'capture' }, {
					id: 'spectra-self', frameId: 9, documentId: 'retired-subframe', tab: { id: TAB_ID } as chrome.tabs.Tab,
				});
			}
			expect(calls).toBe(0);
			expect(badgeState.has(TAB_ID)).toBe(false);
		} finally {
			unsubscribe();
		}
	});

	test.each(['dom-native', 'page-native'] as const)('Popup and local OSD agree for %s gestures', (strategy) => {
		for (const volume of [0, 40, 100, 101, 110, 350]) {
			const muted = volume === 0;
			const popup = gestureVolumeTone({
				muted, volume, actualMode: 'bypass', phase: 'idle', enabled: true,
				controlSnapshot: snapshotWith(strategy),
			});
			expect(resolveHotkeyVolumeTone(factsWith(volume, { muted }))).toBe(popup);
			if (!muted) expect(popup).toBe<VolumeTone>('native');
		}
	});

	test('local feedback can replay an acknowledged Boost route without painting a badge', () => {
		for (const volume of [101, 110, 350]) {
			const popup = gestureVolumeTone({
				muted: false, volume, actualMode: 'bypass', phase: 'idle', enabled: true,
				controlSnapshot: snapshotWith('dom-native', 'capture'),
			});
			expect(resolveHotkeyVolumeTone(factsWith(volume, { boostRoute: 'capture' }))).toBe(popup);
			expect(popup).toBe<VolumeTone>('capture');
		}
		expect(badgeState.has(TAB_ID)).toBe(false);
	});

	test('an acknowledged active Capture gives every surface the same settled tone', async () => {
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async () => undefined,
				setBadgeBackgroundColor: async () => undefined,
				setBadgeTextColor: async () => undefined,
			},
		} });
		for (const volume of [0, 40, 100, 110, 350]) {
			const muted = volume === 0;
			const popup = gestureVolumeTone({
				muted, volume, actualMode: 'capture', phase: 'active', enabled: true,
				controlSnapshot: snapshotWith('dom-native'),
			});
			const pill = resolveHotkeyVolumeTone(factsWith(volume, { muted, actualMode: 'capture', phase: 'active' }));
			await updateBadgeFromControlProjection({
				tabId: TAB_ID, documentId: 'doc', origin: 'https://live.example', generation: 1,
			}, {
				volumeBase: Math.min(volume, 100), boost: volume > 100 ? volume / 100 : 1,
				mediaMuted: muted, audioEnabled: DEFAULT_AUDIO_CONFIG.enabled,
			}, true, true);
			expect(badgeState.get(TAB_ID)?.tone).toBe(popup);
			expect(pill).toBe(popup);
		}
	});
});
