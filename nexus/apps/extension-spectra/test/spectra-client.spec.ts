import { describe, expect, mock, test } from 'bun:test';
import {
	type AudioSessionSnapshot,
	createSpectraEvent,
	createSpectraRequest,
	DEFAULT_AUDIO_CONFIG,
	SPECTRA_PROTOCOL_VERSION,
	rpcSuccess,
} from '@nexus/contracts';
import { sendSpectraRequest, sendSpectraTabRequest } from '../src/shared/spectra-client';

const CONFIG = {
	...DEFAULT_AUDIO_CONFIG,
	eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
};

describe('SPECTRA extension RPC client boundaries', () => {
	test('builds routed envelopes and identifies malformed Background responses', async () => {
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const runtimeSend = mock(async () => rpcSuccess({ saved: true as const }));
		const tabSend = mock(async () => rpcSuccess({
			config: CONFIG,
			hasAudio: true,
			isPlaying: false,
			desiredMode: 'bypass' as const,
			actualMode: 'bypass' as const,
			phase: 'idle' as const,
			generation: 0,
			userInteracted: false,
			pausedAt: null,
			lastError: null,
		}));
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: { sendMessage: runtimeSend },
				tabs: { sendMessage: tabSend },
			},
		});

		try {
			const saved = await sendSpectraRequest('spectra.audio.config.set', { config: CONFIG }, { generation: 3 });
			expect(saved).toEqual(rpcSuccess({ saved: true }));
			expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({
				protocolVersion: 2,
				type: 'spectra.audio.config.set',
				payload: { config: CONFIG },
				generation: 3,
			}));

			const status = await sendSpectraTabRequest(42, 'spectra.audio.runtime.get', {});
			expect(status.ok).toBe(true);
			expect(tabSend).toHaveBeenCalledWith(42, expect.objectContaining({
				protocolVersion: 2,
				type: 'spectra.audio.runtime.get',
				tabId: 42,
				payload: {},
			}));

			runtimeSend.mockImplementationOnce(async () => ({ ok: true, data: { saved: 'yes' } }));
			await expect(sendSpectraRequest('spectra.audio.config.set', { config: CONFIG }))
				.rejects.toThrow(
					'Background returned an invalid SPECTRA extension RPC v2 response for spectra.audio.config.set',
				);
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('stamps every request with the wire owner version and a unique identity', () => {
		const first = createSpectraRequest('spectra.audio.runtime.get', {}, { tabId: 7, generation: 2 });
		const second = createSpectraRequest('spectra.audio.runtime.get', {}, { tabId: 7, generation: 2 });
		expect(first.protocolVersion).toBe(SPECTRA_PROTOCOL_VERSION);
		expect(first.requestId.length).toBeGreaterThan(0);
		expect(first.requestId).not.toBe(second.requestId);
		expect(first).toMatchObject({ type: 'spectra.audio.runtime.get', tabId: 7, generation: 2 });

		const session = {
			tabId: 7,
			documentId: 'document-7',
			origin: 'https://example.test',
			generation: 2,
			desiredMode: 'bypass',
			actualMode: 'bypass',
			phase: 'idle',
			configRevision: 1,
			actualConfig: CONFIG,
			lastError: null,
		} satisfies AudioSessionSnapshot;
		const event = createSpectraEvent('spectra.audio.session.changed', session, { tabId: 7 });
		expect(event.protocolVersion).toBe(SPECTRA_PROTOCOL_VERSION);
		expect(event).not.toHaveProperty('requestId');
		expect(event).toMatchObject({ type: 'spectra.audio.session.changed', tabId: 7, payload: session });
	});
});