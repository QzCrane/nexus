// goal: lock actual and prospective volume-tone boundaries

import { describe, expect, test } from 'bun:test';
import {
	CONTROL_VALUE_LIMITS,
	audioVolumeStateToVolumeTone,
	isActiveCaptureLifecycle,
	resolveAudioVolumeState,
	resolveVolumeTone,
	volumeToneToAudioVolumeState,
} from '@nexus/contracts';

describe('resolveVolumeTone', () => {
	const base = {
		volume: 100,
		muted: false,
		enabled: true,
		captureActive: false,
	} as const;

	test('an active Capture owns the tone only above the native ceiling', () => {
		for (const volume of [101, 350, 800]) {
			expect(resolveVolumeTone({ ...base, volume, captureActive: true })).toBe('capture');
		}
		// At or below the ceiling the split is Boost 1, so a processor that has not
		// released yet is passthrough: the leaving gesture must read blue at once
		// instead of holding violet until the release acknowledgement lands.
		for (const volume of [1, 50, 99, 100]) {
			expect(resolveVolumeTone({ ...base, volume, captureActive: true })).toBe('native');
		}
	});

	test('a threshold alone never implies Capture', () => {
		for (const volume of [101, 350, 800]) {
			expect(resolveVolumeTone({ ...base, volume })).toBe('native');
		}
	});

	test('a gesture uses the current source policy candidate without claiming physical Capture', () => {
		const boundary = CONTROL_VALUE_LIMITS.volumeBase.max;
		for (const volume of [boundary + 1, 350, 800]) {
			expect(resolveVolumeTone({ ...base, volume, predict: true, prospectiveBoostRoute: 'capture' })).toBe('capture');
			expect(resolveVolumeTone({ ...base, volume, predict: true, prospectiveBoostRoute: 'media-webaudio' })).toBe('native');
			expect(resolveVolumeTone({ ...base, volume, predict: true, prospectiveBoostRoute: null })).toBe('native');
			expect(resolveVolumeTone({ ...base, volume, prospectiveBoostRoute: 'capture' })).toBe('native');
		}
		for (const volume of [1, 50, boundary]) {
			expect(resolveVolumeTone({ ...base, volume, predict: true, prospectiveBoostRoute: 'capture' })).toBe('native');
		}
		expect(resolveVolumeTone({ ...base, volume: 350, predict: true, boostRoute: 'capture', prospectiveBoostRoute: 'media-webaudio' })).toBe('native');
		expect(resolveVolumeTone({ ...base, volume: 350, predict: true, boostRoute: 'capture', prospectiveBoostRoute: null })).toBe('native');
		expect(resolveVolumeTone({ ...base, volume: 350, predict: true, boostRoute: 'capture' })).toBe('capture');
		expect(resolveVolumeTone({ ...base, volume: 350, captureActive: true, prospectiveBoostRoute: 'media-webaudio' })).toBe('capture');
		expect(base.captureActive).toBe(false);
	});

	test('never predicts below the native ceiling or on a settled frame', () => {
		expect(resolveVolumeTone({ ...base, volume: 100, predict: true, boostRoute: 'capture' }))
			.toBe('native');
		expect(resolveVolumeTone({ ...base, volume: 350, boostRoute: 'capture' }))
			.toBe('native');
	});

	test('silence and a disabled processor win over the route', () => {
		expect(resolveVolumeTone({ ...base, volume: 0, captureActive: true })).toBe('muted');
		expect(resolveVolumeTone({ ...base, muted: true })).toBe('muted');
		expect(resolveVolumeTone({ ...base, volume: 350, enabled: false, predict: true })).toBe('native');
	});

	// The wire vocabulary (`AudioVolumeState`) and the palette vocabulary
	// (`VolumeTone`) are one decision in two spellings. A surface that reads the
	// acknowledgement and a surface that predicts a gesture therefore cannot
	// describe the same document differently: both are this function.
	test('the acknowledged state is the settled tone in wire spelling', () => {
		for (const actualMode of ['bypass', 'webaudio', 'capture'] as const) {
			for (const phase of ['idle', 'starting', 'active', 'stopping', 'error'] as const) {
				for (const volume of [0, 1, 100, 350]) {
					for (const muted of [false, true]) {
						const tone = resolveVolumeTone({
							volume,
							muted,
							enabled: true,
							captureActive: isActiveCaptureLifecycle({ actualMode, phase }),
						});
						expect(resolveAudioVolumeState({ volume, muted, actualMode, phase }))
							.toBe(volumeToneToAudioVolumeState(tone));
					}
				}
			}
		}
	});

	test('the two vocabularies map round-trip and never invent a fourth case', () => {
		for (const tone of ['muted', 'native', 'capture'] as const) {
			expect(audioVolumeStateToVolumeTone(volumeToneToAudioVolumeState(tone))).toBe(tone);
		}
		for (const state of ['silent', 'native', 'capture'] as const) {
			expect(volumeToneToAudioVolumeState(audioVolumeStateToVolumeTone(state))).toBe(state);
		}
		expect(volumeToneToAudioVolumeState('muted')).toBe('silent');
	});
});
