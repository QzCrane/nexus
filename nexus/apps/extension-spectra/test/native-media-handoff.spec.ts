import { describe, expect, test } from 'bun:test';
import { shouldYieldNativeMediaObservation } from '../src/shared/content-runtime';

// Real-site regression: www.douyin.com/follow -> /follow/live/<id> mounts the
// audible player after the heavy runtime has handed observation ownership to a
// different preview element. A trusted drag on that successor's native volume
// slider produced real `volumechange` events but zero background observations,
// so the badge stayed empty until a Popup click or a reload.
describe('document-start native observation handoff', () => {
	test('yields setup-only changes once the heavy runtime owns observation', () => {
		expect(shouldYieldNativeMediaObservation(true, false, false)).toBe(true);
	});
	test('never yields while no runtime took ownership', () => {
		for (const trustedGesture of [true, false]) {
			for (const pendingTrustedGesture of [true, false]) {
				expect(shouldYieldNativeMediaObservation(false, trustedGesture, pendingTrustedGesture))
					.toBe(false);
			}
		}
	});
	test('keeps a trusted viewer gesture observable after the handoff', () => {
		expect(shouldYieldNativeMediaObservation(true, true, false)).toBe(false);
		expect(shouldYieldNativeMediaObservation(true, true, true)).toBe(false);
	});
	test('keeps an undelivered trusted-gesture obligation alive across later setup events', () => {
		expect(shouldYieldNativeMediaObservation(true, false, true)).toBe(false);
	});
	test('does not widen badge admission: only a trusted gesture is exempt', () => {
		// The exemption is exactly the trusted-input witness. Autoplay, player
		// scaffolding and route restoration still hand every sample to the runtime.
		expect(shouldYieldNativeMediaObservation(true, false, false)).toBe(true);
		expect(shouldYieldNativeMediaObservation(true, true, false)).toBe(false);
	});
});
