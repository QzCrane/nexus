import { describe, expect, test } from 'bun:test';
import {
	createRouter,
	isValidNexusRequestPayload,
	parseNexusMessage,
} from '../../../packages/nexus-kernel/src/messages/router';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';

function audioConfig() {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
	};
}

describe('v1 Nexus message boundary', () => {
	test('normalizes legacy empty objects for void requests', () => {
		const omitted = parseNexusMessage({ action: 'AUDIO_GET_STATUS', source: 'popup' });
		const legacyEmpty = parseNexusMessage({ action: 'VIDEO_ROTATE', payload: {} });

		expect(omitted?.action).toBe('AUDIO_GET_STATUS');
		expect(omitted?.payload).toBeUndefined();
		expect(legacyEmpty?.action).toBe('VIDEO_ROTATE');
		expect(legacyEmpty?.payload).toBeUndefined();
		expect(parseNexusMessage({ action: 'TAB_PIN' })?.payload).toBeUndefined();
		expect(parseNexusMessage({ action: 'TAB_MUTE', payload: {} })?.payload).toBeUndefined();
		expect(parseNexusMessage({ action: 'OPEN_OPTIONS' })?.action).toBe('OPEN_OPTIONS');
		expect(parseNexusMessage({ action: 'OPEN_POPUP' })?.action).toBe('OPEN_POPUP');
	});

	test('rejects malformed envelopes before dispatch', () => {
		expect(parseNexusMessage(null)).toBeNull();
		expect(parseNexusMessage({ action: 'NOT_REGISTERED', payload: {} })).toBeNull();
		expect(parseNexusMessage({ action: 'BADGE_UPDATE', payload: 'invalid' })).toBeNull();
		expect(parseNexusMessage({
			action: 'BADGE_UPDATE',
			payload: { volume: Number.NaN, muted: false, isCapture: false },
		})).toBeNull();
		expect(parseNexusMessage({
			action: 'CAPTURE_UPDATE_CONFIG',
			payload: { tabId: 4, generation: 2, config: { ...audioConfig(), delay: -1 } },
		})).toBeNull();
	});

	test('accepts bounded config intents and legacy remote speed deltas', () => {
		expect(isValidNexusRequestPayload('AUDIO_SET_CONFIG', {
			config: { volumeDelta: 10, toggleMute: false, isNativeSync: true },
		})).toBe(true);
		expect(isValidNexusRequestPayload('AUDIO_SET_CONFIG', {
			config: { volume: 900 },
		})).toBe(false);
		expect(isValidNexusRequestPayload('MEDIA_SET_SPEED', { delta: -0.25 })).toBe(true);
		expect(isValidNexusRequestPayload('SHORTCUT_TRIGGER', { command: 'open_popup' })).toBe(true);
		expect(isValidNexusRequestPayload('SHORTCUT_TRIGGER', { command: 'arbitrary-code' })).toBe(false);
	});

	test('keeps routing metadata constrained', () => {
		expect(parseNexusMessage({
			action: 'CAPTURE_GET_STATE',
			payload: { tabId: 9 },
			source: 'popup',
		})).not.toBeNull();
		expect(parseNexusMessage({
			action: 'CAPTURE_GET_STATE',
			payload: { tabId: 9 },
			source: 'web-page',
		})).toBeNull();
		expect(parseNexusMessage({
			action: 'CAPTURE_GET_STATE',
			payload: { tabId: 9 },
			target: 'arbitrary-target',
		})).toBeNull();
	});

	test('does not dispatch malformed payloads to registered handlers', async () => {
		type RuntimeListener = (
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response?: unknown) => void,
		) => boolean | undefined;
		const originalChrome = globalThis.chrome;
		let listener: RuntimeListener | null = null;
		const chromeMock = {
			runtime: {
				onMessage: {
					addListener: (registered: RuntimeListener) => {
						listener = registered;
					},
				},
			},
			tabs: { query: async () => [] },
		};
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: chromeMock as unknown as typeof chrome,
		});

		try {
			let calls = 0;
			const router = createRouter();
			router.on('BADGE_UPDATE', async () => {
				calls += 1;
			});
			router.listen();

			const registered = listener as RuntimeListener | null;
			expect(registered).not.toBeNull();
			if (!registered) throw new Error('Router listener was not registered');
			expect(registered({
				action: 'BADGE_UPDATE',
				payload: { volume: 'loud', muted: false, isCapture: false },
			}, {}, () => undefined)).toBe(false);
			expect(calls).toBe(0);

			expect(registered({
				action: 'BADGE_UPDATE',
				payload: { volume: 120, muted: false, isCapture: false },
			}, {}, () => undefined)).toBe(true);
			await Promise.resolve();
			await Promise.resolve();
			expect(calls).toBe(1);
		} finally {
			if (originalChrome) {
				Object.defineProperty(globalThis, 'chrome', {
					configurable: true,
					value: originalChrome,
				});
			} else {
				Reflect.deleteProperty(globalThis, 'chrome');
			}
		}
	});
});
