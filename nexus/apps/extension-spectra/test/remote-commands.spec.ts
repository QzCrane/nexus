import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, rpcSuccess, type AudioSessionSnapshot } from '@nexus/contracts';
import { forgetAudioSession } from '../src/background/audio-session-store';
import {
	setStateCallback,
	syncState,
} from '../src/background/remote-commands';

const TAB_ID = 9_301;

afterEach(async () => {
	setStateCallback(null);
	await forgetAudioSession(TAB_ID).catch(() => undefined);
});

describe('remote acknowledged audio state', () => {
	test('publishes background actualConfig/generation without reading desired runtime config', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const snapshot: AudioSessionSnapshot = {
			tabId: TAB_ID,
			documentId: 'document-remote-state',
			origin: 'https://media.example',
			generation: 17,
			desiredMode: 'capture',
			actualMode: 'bypass',
			phase: 'error',
			configRevision: 4,
			actualConfig: {
				...DEFAULT_AUDIO_CONFIG,
				volume: 100,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			},
			lastError: {
				code: 'capture_denied',
				message: 'Capture permission denied',
				retryable: true,
			},
		};
		const sentTypes: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				storage: {
					session: {
						get: async (key: string) => ({ [key]: structuredClone(snapshot) }),
						remove: async () => undefined,
					},
				},
				runtime: { id: 'spectra-test' },
				tabs: {
					get: async () => ({
						id: TAB_ID,
						title: 'Remote media',
						url: 'https://media.example/watch',
					}),
					sendMessage: mock(async (_tabId: number, message: { type: string }) => {
						sentTypes.push(message.type);
						if (message.type === 'spectra.media.state.get') {
							return rpcSuccess({
								playing: true,
								speed: 1.5,
								pipActive: false,
								preservePitch: true,
							});
						}
						throw new Error(`Unexpected tab request: ${message.type}`);
					}),
				},
			},
		});

		try {
			let published: unknown;
			setStateCallback((_tabId, state) => { published = state; });
			await syncState(TAB_ID);

			expect(published).toEqual({
				generation: 17,
				volume: 100,
				muted: false,
				playing: true,
				speed: 1.5,
				tabTitle: 'Remote media',
				tabDomain: 'media.example',
			});
			expect(sentTypes).toEqual(['spectra.media.state.get']);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
