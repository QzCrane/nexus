import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, type AudioSessionSnapshot } from '@nexus/contracts';
import {
	updateBadgeFromControlProjection,
	updateBadgeFromSession,
} from '../src/background/handlers/badge';
import { BADGE_COLORS, badgeState } from '../src/background/state';

const TAB_ID = 7_701;
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	badgeState.clear();
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

		await updateBadgeFromControlProjection(identity(), {
			...DEFAULT_AUDIO_CONFIG,
			volume: 350,
			volumeBase: 100,
			boost: 3.5,
		}, false, true);
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

		await updateBadgeFromControlProjection(identity(), {
			...DEFAULT_AUDIO_CONFIG,
			volume: 0,
			volumeBase: 0,
			boost: 1,
		}, true, true);
		expect(colors.at(-1)).toBe(BADGE_COLORS.MUTED);
	});

	test('clears rather than recoloring a stale control projection for another document', async () => {
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

		await updateBadgeFromControlProjection(identity(), DEFAULT_AUDIO_CONFIG, false, true);
		await updateBadgeFromSession({
			...session('active'),
			documentId: 'document-new',
			generation: 5,
		}, true);

		expect(badgeState.has(TAB_ID)).toBe(false);
		expect(texts.at(-1)).toBe('');
	});
});

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
