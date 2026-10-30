import { afterEach, describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	type AudioSessionSnapshot,
	type ControlSessionPatch,
} from '@nexus/contracts';
import {
	updateBadgeFromControlProjection,
	updateBadgeFromSession,
	markBadgeUsedForTab,
} from '../src/background/handlers/badge';
import { BADGE_COLORS, badgeState } from '../src/background/state';
import { resetBadgeUsageForTests } from '../src/background/badge-usage';

const TAB_ID = 7_701;
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	badgeState.clear();
	resetBadgeUsageForTests();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('actual volume badge state', () => {
	test('uses control ACK volume and turns purple only for active Capture', async () => {
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				action: {
					setBadgeText: async () => undefined,
					setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 100,
			boost: 3.5,
		}), false, true);
		expect(badgeState.get(TAB_ID)?.volume).toBe(350);
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);

		await updateBadgeFromSession(session('starting'), true);
		expect(badgeState.get(TAB_ID)?.volume).toBe(350);
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);

		await updateBadgeFromSession({ ...session('active'), generation: 5 }, true);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 350, isCapture: true });
		expect(colors.at(-1)).toBe(BADGE_COLORS.CAPTURE);

		await updateBadgeFromSession({ ...session('error'), generation: 6 }, true);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 350, isCapture: false });
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);
	});

	test('keeps silence gray even while Capture is active', async () => {
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				action: {
					setBadgeText: async () => undefined,
					setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 0,
			boost: 1,
		}), true, true);
		expect(colors.at(-1)).toBe(BADGE_COLORS.MUTED);
	});

	test('clears the previous document projection instead of keeping a stale mute', async () => {
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		// The old document was muted by the user, so the tab shows M.
		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 0,
			boost: 1,
			mediaMuted: true,
		}), false, true);
		expect(texts.at(-1)).toBe('M');

		// The replacement document is unmuted and has no control ACK yet. Keeping
		// the old M would claim this page is muted, which is exactly the reported
		// "badge shows mute" symptom.
		await updateBadgeFromSession({
			...session('active'),
			documentId: 'document-new',
			generation: 5,
		}, true);

		expect(badgeState.has(TAB_ID)).toBe(false);
		expect(texts.at(-1)).toBe('');
	});

	test('leaves an existing projection alone when a restarted worker has no document identity', async () => {
		const values: Record<string, unknown> = { [`spectra.badge.used.${TAB_ID}`]: true };
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
					remove: async (key: string) => { delete values[key]; },
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		// A restarted worker has no badgeState, so it cannot prove the visible
		// projection belongs to another document. Preserving it is the only
		// non-inventing option; a document we *can* compare is cleared below.
		await updateBadgeFromSession(session('active'), true);

		expect(badgeState.has(TAB_ID)).toBe(false);
		expect(texts).toHaveLength(0);
	});

	test('hides untouched native observations but restores sticky usage after a worker restart', async () => {
		const values: Record<string, unknown> = {};
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
					remove: async (key: string) => { delete values[key]; },
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await updateBadgeFromControlProjection(identity(), projection(), false, false);
		expect(texts.at(-1)).toBe('');
		await updateBadgeFromControlProjection(identity(), projection(), false, true);
		expect(texts.at(-1)).toBe('100');

		badgeState.clear();
		resetBadgeUsageForTests();
		await updateBadgeFromControlProjection(identity(), projection(), false, false);
		expect(texts.at(-1)).toBe('100');
		expect(badgeState.get(TAB_ID)?.userInteracted).toBe(true);
	});

	test('persists usage without rendering a placeholder before any volume ACK exists', async () => {
		const values: Record<string, unknown> = {};
		const texts: string[] = [];
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
					remove: async (key: string) => { delete values[key]; },
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await markBadgeUsedForTab(TAB_ID);
		expect(texts.at(-1) ?? '').toBe('');
		expect(colors).toHaveLength(0);
		resetBadgeUsageForTests();
		await markBadgeUsedForTab(TAB_ID);
		expect(texts.at(-1) ?? '').toBe('');
	});

	test('keeps a sparse non-volume ACK neutral instead of inventing 100 percent', async () => {
		const values: Record<string, unknown> = {};
		let badgeText = '';
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
					remove: async (key: string) => { delete values[key]; },
				} },
				action: {
					getBadgeText: async () => badgeText,
					setBadgeText: async ({ text }: { text: string }) => {
						badgeText = text;
						texts.push(text);
					},
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await updateBadgeFromControlProjection(identity(), { speed: 1.75 }, false, true);
		expect(texts.at(-1) ?? '').toBe('');
		expect(texts).not.toContain('100');

		badgeState.clear();
		resetBadgeUsageForTests();
		await updateBadgeFromControlProjection(identity(), { speed: 1.75 }, false, false);
		expect(texts.at(-1) ?? '').toBe('');
	});

	test('paints the newest decision when a session report is already in flight', async () => {
		const values: Record<string, unknown> = {};
		const texts: string[] = [];
		let tabsCalls = 0;
		let releaseTabs: (() => void) | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: {
					get: async () => {
						tabsCalls += 1;
						// Park exactly one paint: the session report below decides, then
						// waits here while the user's unmute ACK overtakes it. Without the
						// park the two paths never interleave and the race is invisible.
						if (tabsCalls === 2) {
							await new Promise<void>((release) => { releaseTabs = release; });
						}
						return { id: TAB_ID };
					},
				},
				storage: { session: {
					get: async (key: string) => key in values ? { [key]: values[key] } : {},
					set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
					remove: async (key: string) => { delete values[key]; },
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		// The tab is muted by the user, so the badge reads M.
		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 0,
			boost: 1,
			mediaMuted: true,
		}), false, true);
		expect(texts.at(-1)).toBe('M');

		// A session report that still says "muted" is already on the wire when the
		// user unmutes. In the old ordering it painted its captured M *after* the
		// ACK and the badge stayed M for the rest of the tab's life - the reported
		// symptom. The decision is now recorded synchronously and the paint reads
		// the newest decision, so the stale report can only repaint the ACK.
		const inFlight = updateBadgeFromSession(session('active'), true);
		for (let tick = 0; tick < 50 && !releaseTabs; tick += 1) {
			await new Promise((next) => setTimeout(next, 0));
		}
		expect(releaseTabs).toBeDefined();

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 63,
			boost: 1,
			mediaMuted: false,
		}), false, false);
		expect(texts.at(-1)).toBe('63');

		releaseTabs?.();
		await inFlight;
		expect(texts.at(-1)).toBe('63');
		expect(texts.filter((text) => text === 'M')).toHaveLength(1);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 63, muted: false });
	});
});

function projection(overrides: ControlSessionPatch = {}): ControlSessionPatch {
	return {
		audioEnabled: true,
		volumeBase: 100,
		boost: 1,
		mediaMuted: false,
		...overrides,
	};
}

function identity() {
	return {
		tabId: TAB_ID,
		documentId: 'document-badge',
		origin: 'https://media.example',
		generation: 4,
	};
}

function session(phase: AudioSessionSnapshot['phase']): AudioSessionSnapshot {
	return {
		tabId: TAB_ID,
		documentId: 'document-badge',
		origin: 'https://media.example',
		generation: 4,
		desiredMode: 'capture',
		actualMode: 'capture',
		phase,
		configRevision: 1,
		actualConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		lastError: phase === 'error'
			? { code: 'capture_failed', message: 'Capture stopped', retryable: true }
			: null,
	};
}
