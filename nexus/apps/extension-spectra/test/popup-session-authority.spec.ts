import { describe, expect, test } from 'bun:test';
import { Actions, DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { setupCardMessaging } from '../src/popup/card/messaging';
import type { CardInternalState } from '../src/popup/card/types';

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
) => boolean | undefined;

describe('Popup audio-session authority', () => {
	test('ignores capture predictions and updates mode only from AudioSessionSnapshot', () => {
		const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		let listener: RuntimeListener | undefined;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: RuntimeListener) => { listener = next; },
						removeListener: () => undefined,
					},
				},
			},
		});
		const state = createState();
		let renders = 0;

		try {
			setupCardMessaging({ tabId: 17, state, render: () => { renders += 1; } });
			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.capture.changed',
				tabId: 17,
				generation: 5,
				payload: {
					tabId: 17,
					generation: 5,
					phase: 'active',
					active: true,
					actualMode: 'capture',
					lastError: null,
				},
			}, {});
			listener?.({
				action: Actions.CAPTURE_STATE_CHANGE,
				payload: { tabId: 17, enabled: true },
			}, {});
			expect(state.actualMode).toBe('bypass');
			expect(state.phase).toBe('idle');
			expect(state.isCaptureActive).toBe(false);
			expect(renders).toBe(0);

			listener?.({
				protocolVersion: 2,
				type: 'spectra.audio.session.changed',
				tabId: 17,
				documentId: 'document-17',
				generation: 5,
				payload: {
					tabId: 17,
					documentId: 'document-17',
					origin: 'https://media.example',
					generation: 5,
					desiredMode: 'capture',
					actualMode: 'capture',
					phase: 'active',
					configRevision: 1,
					actualConfig: { ...DEFAULT_AUDIO_CONFIG, volume: 137 },
					lastError: null,
				},
			}, {});

			expect(state.actualMode).toBe('capture');
			expect(state.phase).toBe('active');
			expect(state.isCaptureActive).toBe(true);
			expect(state.config.volume).toBe(137);
			expect(renders).toBe(1);
		} finally {
			if (chromeDescriptor) Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		isCaptureActive: false,
		userInteracted: false,
		isRestrictedSite: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		generation: 0,
		lastError: null,
		isDragging: false,
	};
}
