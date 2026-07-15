import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, rpcSuccess } from '@nexus/contracts';
import { sendSpectraRequest, sendSpectraTabRequest } from '../src/shared/spectra-client';

const CONFIG = {
	...DEFAULT_AUDIO_CONFIG,
	eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
};

describe('SPECTRA v2 client boundaries', () => {
	test('builds routed envelopes and rejects malformed peer responses', async () => {
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
				.rejects.toThrow('invalid SPECTRA v2 response');
		} finally {
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});
});
