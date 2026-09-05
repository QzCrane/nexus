import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	isSpectraResponse,
} from '@nexus/contracts';
import { createCaptureAdmission } from './helpers/capture-admission';

describe('audio processor protocol boundary', () => {
	test('accepts an admitted Capture transition but rejects the retired force field', () => {
		const payload = {
			enabled: true as const,
			config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
			admission: createCaptureAdmission({
				document: { tabId: 7, frameId: 0, documentId: 'document:force-boundary' },
			}),
		};
		const request = {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			requestId: 'capture-boundary-request',
			type: 'spectra.audio.capture.set' as const,
			generation: 3,
			payload,
		};

		expect(isSpectraRequestEnvelope(request)).toBe(true);
		expect(isSpectraRequestEnvelope({
			...request,
			payload: { ...payload, force: true },
		})).toBe(false);
	});

	test('accepts canonical WebAudio and rejects the retired enum token', () => {
		for (const [mode, accepted] of [
			['webaudio', true],
			['NATIVE_WEBAUDIO', false],
		] as const) {
			const data = {
				tabId: 7,
				documentId: 'document:force-boundary',
				origin: 'https://media.example',
				generation: 3,
				desiredMode: mode,
				actualMode: mode,
				phase: 'active',
				configRevision: 1,
				actualConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				lastError: null,
			};
			expect(isSpectraResponse(
				'spectra.audio.session.publish',
				{ ok: true, data },
			), mode).toBe(accepted);
		}
	});
});
