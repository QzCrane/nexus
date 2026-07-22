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

	test('preserves the last truthful badge while a used tab establishes a new document projection', async () => {
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

		await updateBadgeFromControlProjection(identity(), projection(), false, true);
		await updateBadgeFromSession({
			...session('active'),
			documentId: 'document-new',
			generation: 5,
		}, true);

		expect(badgeState.has(TAB_ID)).toBe(false);
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

	test('shows a neutral persistent usage badge for a successful non-audio plugin action', async () => {
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
		expect(texts.at(-1)).toBe('•');
		expect(colors.at(-1)).toBe('#94a3b8');
		resetBadgeUsageForTests();
		await markBadgeUsedForTab(TAB_ID);
		expect(texts.at(-1)).toBe('•');
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
		expect(texts.at(-1)).toBe('•');
		expect(texts).not.toContain('100');

		badgeState.clear();
		resetBadgeUsageForTests();
		await updateBadgeFromControlProjection(identity(), { speed: 1.75 }, false, false);
		expect(texts.at(-1)).toBe('•');
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
