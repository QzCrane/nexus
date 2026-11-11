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
	resetPaintedBadgesForTests,
	forgetBadgePresentation,
	stageBadgeVolumePresentation,
	settleBadgeVolumePresentation,
} from '../src/background/handlers/badge';
import { BADGE_COLORS, badgeState } from '../src/background/state';
import { hasBadgeUsage, resetBadgeUsageForTests } from '../src/background/badge-usage';
import { fenceAudioSession, flushAudioSessions, forgetAudioSession, updateAudioSession } from '../src/background/audio-session-store';

const TAB_ID = 7_701;
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
let hasAudioSession = false;

afterEach(async () => {
	if (hasAudioSession) {
		await flushAudioSessions(TAB_ID);
		await forgetAudioSession(TAB_ID);
		hasAudioSession = false;
	}
	badgeState.clear();
	resetBadgeUsageForTests();
	resetPaintedBadgesForTests();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('actual volume badge state', () => {
	test('a newer admitted page sample replaces an unsettled optimistic presentation', async () => {
		// A gesture whose write never settles keeps a presentation staged. The page's
		// own volume change is still physical truth and must reach the badge without
		// the Popup or a later playback gesture settling the old presentation.
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: { setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
				setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined },
		} });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 1);
		await stageBadgeVolumePresentation(
			{ ...identity(), revision: 1 }, { owner: 'hotkey:gesture', revision: 1 }, 110, 'capture',
		);
		expect(texts.at(-1)).toBe('110');
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 45 }), false, false, 2);
		expect(texts.at(-1)).toBe('45');
	});

	test('a staged presentation still wins until a newer decision is admitted', async () => {
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: { setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
				setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined },
		} });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 1);
		await stageBadgeVolumePresentation(
			{ ...identity(), revision: 2 }, { owner: 'hotkey:gesture', revision: 1 }, 110, 'capture',
		);
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 45 }), false, false, 2);
		expect(texts.at(-1)).toBe('110');
	});

	test('a newer admitted actual immediately replaces the previous volume', async () => {
		let text = '';
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: { setBadgeText: async (value: { text: string }) => { text = value.text; },
				setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined },
		} });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 60 }), false, true, 1);
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 40 }), false, true, 1);
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 2);
		expect(text).toBe('80');
		expect(badgeState.get(TAB_ID)?.volume).toBe(80);
	});

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

		await publishBadgeSession(session('starting'), true);
		expect(badgeState.get(TAB_ID)?.volume).toBe(350);
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);

		await publishBadgeSession({ ...session('active'), generation: 5 }, true);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 350, isCapture: true });
		expect(badgeState.get(TAB_ID)?.generation).toBe(4);
		expect(colors.at(-1)).toBe(BADGE_COLORS.CAPTURE);

		await publishBadgeSession({ ...session('error'), generation: 6 }, true);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 350, isCapture: false });
		expect(badgeState.get(TAB_ID)?.generation).toBe(4);
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

	test('an acknowledged mute immediately replaces the previous volume display', async () => {
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

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 100,
			boost: 1,
			mediaMuted: false,
		}), false, true);
		expect(texts.at(-1)).toBe('100');

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 100,
			boost: 1,
			mediaMuted: true,
		}), false, true, 2);

		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 100, muted: true, tone: 'muted' });
		expect(texts.at(-1)).toBe('M');
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
		await publishBadgeSession({
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
		await publishBadgeSession(session('active'));

		expect(badgeState.has(TAB_ID)).toBe(false);
		expect(texts).toHaveLength(0);
	});

	test('a session report can neither create usage nor a badge on an untouched tab (I10)', async () => {
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

		// A programmatic document publishes a session without a viewer gesture.
		await publishBadgeSession(session('active'));
		expect(await hasBadgeUsage(TAB_ID)).toBe(false);
		expect(badgeState.has(TAB_ID)).toBe(false);
		// Clearing an empty projection is allowed; showing any text is not.
		expect(texts.every((text) => text === '')).toBe(true);

		// Only an acknowledged gesture can promote the tab to used, and a session
		// alone still carries no volume facts to paint.
		await publishBadgeSession(session('active'), true);
		expect(await hasBadgeUsage(TAB_ID)).toBe(true);
		expect(badgeState.has(TAB_ID)).toBe(false);
		await updateBadgeFromControlProjection(identity(), projection(), false, false, 1);
		expect(badgeState.get(TAB_ID)?.userInteracted).toBe(true);
		expect(texts.at(-1)).toBe('100');
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

	test('treats an absent boost as the neutral multiplier for a page-native volume', async () => {
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async () => ({}),
					set: async () => undefined,
					remove: async () => undefined,
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		// A page-native observation reports the element's own 0-100 level and
		// states nothing about Boost. That is the neutral multiplier, not an
		// absent volume: treating it as absent cleared the badge on every gesture.
		await updateBadgeFromControlProjection(identity(), {
			volumeBase: 60,
			mediaMuted: false,
		}, false, true);

		expect(texts.at(-1)).toBe('60');
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 60, muted: false });
	});

	test('paints one repeated projection once and repaints when it changes', async () => {
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				storage: { session: {
					get: async () => ({}),
					set: async () => undefined,
					remove: async () => undefined,
				} },
				action: {
					setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		// A page volume drag emits a sample per frame. The Action API is not a
		// per-frame channel, so an unchanged decision must not reach it again.
		for (let index = 0; index < 4; index += 1) {
			await updateBadgeFromControlProjection(identity(), projection({
				volumeBase: 40,
			}), false, true);
		}
		expect(texts).toEqual(['40']);

		await updateBadgeFromControlProjection(identity(), projection({
			volumeBase: 41,
		}), false, true);
		expect(texts).toEqual(['40', '41']);
	});

	test('forgetting a document retires its paint cache and projection order', async () => {
		const texts: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async ({ text }: { text: string }) => { texts.push(text); },
				setBadgeBackgroundColor: async () => undefined,
				setBadgeTextColor: async () => undefined,
			},
		} });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 9);
		forgetBadgePresentation(TAB_ID);
		expect(badgeState.has(TAB_ID)).toBe(false);
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 1);
		expect(texts).toEqual(['80', '80']);
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
		const inFlight = publishBadgeSession(session('active'), true);
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




	test('drops a projection older than the one already decided', async () => {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: { get: async () => ({ id: TAB_ID }) },
				action: {
					setBadgeText: async () => undefined,
					setBadgeBackgroundColor: async () => undefined,
					setBadgeTextColor: async () => undefined,
				},
			},
		});

		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 120 }), false, true, 9);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 120 });

		// A projection resolved after a newer one must not paint its stale facts
		// back over the badge: revision is the only order the two routes share.
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 60 }), false, true, 8);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 120 });

		// A page observation keeps the snapshot revision, so two admitted samples
		// can share one. Equal is the newest fact and must never be dropped.
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 130 }), false, true, 9);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 130 });
	});


	test.each([
		['documentId', 'document-replaced'],
		['origin', 'https://other.example'],
	] as const)('rejects a control projection whose %s differs from the current audio owner', async (field, value) => {
		let paints = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async () => { paints += 1; },
				setBadgeBackgroundColor: async () => undefined,
				setBadgeTextColor: async () => undefined,
			},
		} });
		const current = await commitBadgeSession({ ...session('active'), [field]: value });
		await updateBadgeFromControlProjection(identity(), projection(), true, false, 1);
		expect(paints).toBe(0);
		expect(badgeState.has(TAB_ID)).toBe(false);
		await updateBadgeFromControlProjection({
			...identity(), documentId: current.documentId, origin: current.origin,
		}, projection(), false, true, 1);
		expect(badgeState.get(TAB_ID)).toMatchObject({
			documentId: current.documentId, origin: current.origin, isCapture: true,
		});
	});

	test('a control projection cannot revive an audio identity retired by navigation', async () => {
		let paints = 0;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async () => { paints += 1; },
				setBadgeBackgroundColor: async () => undefined,
				setBadgeTextColor: async () => undefined,
			},
		} });
		await commitBadgeSession(session('active'));
		await updateBadgeFromControlProjection(identity(), projection(), true, true, 1);
		expect(paints).toBe(1);
		fenceAudioSession(TAB_ID);
		forgetBadgePresentation(TAB_ID);
		await updateBadgeFromControlProjection(identity(), projection(), true, false, 2);
		expect(paints).toBe(1);
		expect(badgeState.has(TAB_ID)).toBe(false);
	});

	test('refreshes a stale Capture hint before repainting the acknowledged volume', async () => {
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async () => undefined,
				setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
				setBadgeTextColor: async () => undefined,
			},
		} });
		await commitBadgeSession({ ...session('active'), generation: 1 });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 110 }), false, true, 1);
		expect(badgeState.get(TAB_ID)).toMatchObject({ isCapture: true, tone: 'capture', generation: 4 });
		expect(colors.at(-1)).toBe(BADGE_COLORS.CAPTURE);
		await commitBadgeSession({ ...session('error'), generation: 2 });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 110 }), true, false, 1);
		expect(badgeState.get(TAB_ID)).toMatchObject({ isCapture: false, tone: 'native', generation: 4 });
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);
	});

	test('uses the audio lifecycle clock independently while retaining the control generation', async () => {
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

		await updateBadgeFromControlProjection(
			{ ...identity(), generation: 42 },
			projection({ volumeBase: 95, boost: 2 }),
			false,
			true,
			12,
		);
		const active = await commitBadgeSession({ ...session('active'), generation: 1 });
		await updateBadgeFromSession(active);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 190, generation: 42, isCapture: true });
		expect(colors.at(-1)).toBe(BADGE_COLORS.CAPTURE);

		await commitBadgeSession({ ...session('error'), generation: 2 });
		// A late event resolves the store's current lifecycle and cannot revive Capture.
		await updateBadgeFromSession(active);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 190, generation: 42, isCapture: false });
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);

		const newerActive = await commitBadgeSession({ ...session('active'), generation: 3 });
		await updateBadgeFromSession(newerActive);
		expect(badgeState.get(TAB_ID)).toMatchObject({ generation: 42, isCapture: true });
		await commitBadgeSession({ ...session('error'), generation: 3, actualConfig: {
			...DEFAULT_AUDIO_CONFIG, volume: 50, volumeBase: 50, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		} });
		await updateBadgeFromSession(newerActive);
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 190, generation: 42, isCapture: false });
		await updateBadgeFromSession({ ...newerActive, documentId: 'retired-document', generation: 100 });
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 190, generation: 42, isCapture: false });
	});
});

async function commitBadgeSession(snapshot: AudioSessionSnapshot): Promise<AudioSessionSnapshot> {
	if (!hasAudioSession) {
		const values: Record<string, unknown> = {};
		Object.assign(chrome, {
			storage: { ...chrome.storage, local: {
				get: async (key: string) => ({ [key]: values[key] }),
				set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
				remove: async (key: string) => { delete values[key]; },
			} },
			runtime: { ...chrome.runtime, sendMessage: async () => undefined },
		});
		hasAudioSession = true;
	}
	return updateAudioSession({ tabId: snapshot.tabId, documentId: snapshot.documentId, origin: snapshot.origin }, {
		config: snapshot.actualConfig,
		generation: snapshot.generation,
		desiredMode: snapshot.desiredMode,
		actualMode: snapshot.actualMode,
		phase: snapshot.phase,
		error: snapshot.lastError?.message ?? null,
	});
}

async function publishBadgeSession(snapshot: AudioSessionSnapshot, confirmedGesture = false): Promise<void> {
	if (confirmedGesture) await markBadgeUsedForTab(TAB_ID);
	await updateBadgeFromSession(await commitBadgeSession(snapshot));
}


describe('token-bound pending badge presentation', () => {
	test('the first Capture presentation is purple immediately without inventing actual state or usage', async () => {
		const writes: string[] = [];
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			storage: { session: { get: async () => ({}) } },
			action: {
				setBadgeText: async ({ text }: { text: string }) => { writes.push(text); },
				setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
				setBadgeTextColor: async () => undefined,
			},
		} });
		const pending = stageBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 }, 110, 'capture');
		expect(writes.at(-1)).toBe('110');
		expect(colors.at(-1)).toBe(BADGE_COLORS.CAPTURE);
		expect(badgeState.has(TAB_ID)).toBe(false);
		await pending;
		await settleBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 });
		expect(writes.at(-1)).toBe('');
		expect(badgeState.has(TAB_ID)).toBe(false);
	});

	test('an older settlement preserves the newer pending gesture and failure returns to actual', async () => {
		const writes: string[] = [];
		const colors: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
			tabs: { get: async () => ({ id: TAB_ID }) },
			action: {
				setBadgeText: async ({ text }: { text: string }) => { writes.push(text); },
				setBadgeBackgroundColor: async ({ color }: { color: string }) => { colors.push(color); },
				setBadgeTextColor: async () => undefined,
			},
		} });
		await updateBadgeFromControlProjection(identity(), projection({ volumeBase: 80 }), false, true, 1);
		await stageBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 }, 110, 'capture');
		await stageBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 2 }, 120, 'capture');
		await settleBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 });
		expect(writes.at(-1)).toBe('120');
		expect(badgeState.get(TAB_ID)).toMatchObject({ volume: 80, isCapture: false, tone: 'native' });
		await settleBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 2 });
		expect(writes.at(-1)).toBe('80');
		expect(colors.at(-1)).toBe(BADGE_COLORS.NATIVE);
	});

	test('navigation clears a pending-only badge and a late settlement cannot revive it', async () => {
		const writes: string[] = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { action: {
			setBadgeText: async ({ text }: { text: string }) => { writes.push(text); },
			setBadgeBackgroundColor: async () => undefined, setBadgeTextColor: async () => undefined,
		} } });
		await stageBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 }, 110, 'capture');
		forgetBadgePresentation(TAB_ID);
		expect(writes.at(-1)).toBe('');
		await settleBadgeVolumePresentation(identity(), { owner: 'popup-session', revision: 1 });
		expect(writes.at(-1)).toBe('');
		expect(badgeState.has(TAB_ID)).toBe(false);
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
