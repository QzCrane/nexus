// goal: lock the contract that decides when a volume gesture holds the tone
// inv: the predicate never describes the displayed number, only the tone

import { describe, expect, test } from 'bun:test';
import {
	CONTROL_VALUE_LIMITS,
	crossesVolumeRoute,
	resolveVolumeTone,
	shouldHoldVolumeTone,
} from '@nexus/contracts';

const BOUNDARY = CONTROL_VALUE_LIMITS.volumeBase.max;

describe('volume route boundary', () => {
	test('is the native volume ceiling, not a repeated literal', () => {
		expect(BOUNDARY).toBe(100);
		expect(crossesVolumeRoute(BOUNDARY - 1, BOUNDARY)).toBe(false);
		expect(crossesVolumeRoute(BOUNDARY, BOUNDARY + 1)).toBe(true);
	});

	test('treats movement inside one route as no crossing', () => {
		expect(crossesVolumeRoute(40, 99)).toBe(false);
		expect(crossesVolumeRoute(200, 800)).toBe(false);
		expect(crossesVolumeRoute(0, BOUNDARY)).toBe(false);
	});

	test('detects crossing in both directions', () => {
		expect(crossesVolumeRoute(100, 110)).toBe(true);
		expect(crossesVolumeRoute(110, 100)).toBe(true);
		expect(crossesVolumeRoute(800, 1)).toBe(true);
	});
});

describe('shouldHoldVolumeTone', () => {
	test('never holds when the effective volume did not change', () => {
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: 120,
			nextEffectiveVolume: 120,
			mutedChanged: true,
		})).toBe(false);
	});

	test('does not hold an ordinary same-route drag', () => {
		// The slider spans 0..800, so these are consecutive pointer samples of a
		// normal gesture. Holding any of them is what froze the bar before.
		for (const [previous, next] of [[40, 55], [55, 80], [80, 99], [200, 480]] as const) {
			expect(shouldHoldVolumeTone({
				previousEffectiveVolume: previous,
				nextEffectiveVolume: next,
				mutedChanged: false,
			})).toBe(false);
		}
	});

	test('holds the tone across the native/boost boundary in either direction', () => {
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: 100,
			nextEffectiveVolume: 110,
			mutedChanged: false,
		})).toBe(true);
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: 110,
			nextEffectiveVolume: 100,
			mutedChanged: false,
		})).toBe(true);
	});

	test('holds the tone when the same patch also flips mute', () => {
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: 40,
			nextEffectiveVolume: 80,
			mutedChanged: true,
		})).toBe(true);
	});

	test('refuses to hold on values nothing can explain', () => {
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: Number.NaN,
			nextEffectiveVolume: 110,
			mutedChanged: false,
		})).toBe(false);
		expect(shouldHoldVolumeTone({
			previousEffectiveVolume: 100,
			nextEffectiveVolume: Number.POSITIVE_INFINITY,
			mutedChanged: true,
		})).toBe(false);
	});
});

// The Popup slider and the Action badge used to decide violet independently: the
// slider from the gesture, the badge from an `isCapture` boolean that ignored
// the volume. Below 100 that painted a violet badge next to a blue bar; right
// after a crossing it painted a blue badge next to a violet bar. One predicate,
// two consumers, and neither can drift again.
describe('resolveVolumeTone', () => {
	const base = {
		volume: 100,
		muted: false,
		enabled: true,
		captureActive: false,
	} as const;

	test('an active Capture owns the tone at every volume', () => {
		for (const volume of [1, 50, 99, 100, 101, 350, 800]) {
			expect(resolveVolumeTone({ ...base, volume, captureActive: true })).toBe('capture');
		}
	});

	test('a threshold alone never implies Capture', () => {
		for (const volume of [101, 350, 800]) {
			expect(resolveVolumeTone({ ...base, volume })).toBe('native');
		}
	});

	test('a live gesture predicts the hijack only where the page cannot amplify', () => {
		const gesture = { ...base, volume: 350, predict: true } as const;
		expect(resolveVolumeTone({ ...gesture, nativeRoute: 'dom-native' })).toBe('capture');
		expect(resolveVolumeTone({ ...gesture, nativeRoute: 'page-native' })).toBe('native');
		expect(resolveVolumeTone({ ...gesture, nativeRoute: null })).toBe('native');
		// An acknowledged route outranks the page-level guess in both directions.
		expect(resolveVolumeTone({
			...gesture, nativeRoute: 'dom-native', boostRoute: 'media-webaudio',
		})).toBe('native');
		expect(resolveVolumeTone({
			...gesture, nativeRoute: 'page-native', boostRoute: 'capture',
		})).toBe('capture');
	});

	test('never predicts below the native ceiling or on a settled frame', () => {
		expect(resolveVolumeTone({ ...base, volume: 100, predict: true, nativeRoute: 'dom-native' }))
			.toBe('native');
		expect(resolveVolumeTone({ ...base, volume: 350, nativeRoute: 'dom-native' }))
			.toBe('native');
	});

	test('silence and a disabled processor win over the route', () => {
		expect(resolveVolumeTone({ ...base, volume: 0, captureActive: true })).toBe('muted');
		expect(resolveVolumeTone({ ...base, muted: true })).toBe('muted');
		expect(resolveVolumeTone({ ...base, volume: 350, enabled: false, predict: true })).toBe('native');
	});
});
