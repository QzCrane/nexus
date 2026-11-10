// goal: lock the one palette decision a shortcut gesture paints
// inv: prospective policy routes affect gestures; physical ownership requires ACK
// post: every assertion here is reproducible from the same control fields the
// Popup renders, so the pill, the slider and the badge cannot disagree

import { describe, expect, test } from 'bun:test';
import {
	resolveHotkeyVolumeTone,
	resolveSettledVolumeTone,
	type HotkeyVolumeToneFacts,
} from '../src/content/ui/hotkey-volume-tone';

const facts = (overrides: Partial<HotkeyVolumeToneFacts> = {}): HotkeyVolumeToneFacts => ({
	volume: 110,
	muted: false,
	enabled: true,
	actualMode: 'bypass',
	phase: 'idle',
	boostRoute: undefined,
	...overrides,
});

describe('hotkey volume tone', () => {
	test('paints the value the gesture is showing, below the ceiling', () => {
		expect(resolveHotkeyVolumeTone(facts({ volume: 100 }))).toBe('native');
		expect(resolveHotkeyVolumeTone(facts({ volume: 40 }))).toBe('native');
		expect(resolveHotkeyVolumeTone(facts({ volume: 0 }))).toBe('muted');
		expect(resolveHotkeyVolumeTone(facts({ volume: 60, muted: true }))).toBe('muted');
	});

	test('a crossing above the ceiling is not a colour of its own', () => {
		// An unknown route cannot be inferred from the number alone.
		for (const volume of [101, 110, 350, 800]) {
			expect(resolveHotkeyVolumeTone(facts({ volume }))).toBe('native');
		}
	});

	test('an acknowledged Capture owns the tone only above the native ceiling', () => {
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, actualMode: 'capture', phase: 'active',
		}))).toBe('capture');
		// Leaving the Boost range predicts a passthrough split (Boost 1), so the
		// same frame that shows 100 must show blue; holding violet until the
		// processor releases is the asymmetric lag this spec rejects.
		expect(resolveHotkeyVolumeTone(facts({
			volume: 100, actualMode: 'capture', phase: 'active',
		}))).toBe('native');
		expect(resolveHotkeyVolumeTone(facts({
			volume: 50, actualMode: 'capture', phase: 'active',
		}))).toBe('native');
		// A capture that is still starting, or that failed, is not owning audio
		// yet: painting violet there is the premature repaint this spec exists to
		// prevent.
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, actualMode: 'capture', phase: 'starting',
		}))).toBe('native');
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, actualMode: 'capture', phase: 'error',
		}))).toBe('native');
	});

	test('an acknowledged Capture Boost owner remains a fallback for a gesture', () => {
		expect(resolveHotkeyVolumeTone(facts({
			volume: 110, boostRoute: 'capture',
		}))).toBe('capture');
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, boostRoute: 'capture',
		}))).toBe('capture');
		// Below the ceiling there is no Boost to hand over.
		expect(resolveHotkeyVolumeTone(facts({
			volume: 100, boostRoute: 'capture',
		}))).toBe('native');
	});

	test('the first Capture crossing uses the policy candidate for the gesture only', () => {
		const first = facts({ volume: 110, prospectiveBoostRoute: 'capture' });
		expect(resolveHotkeyVolumeTone(first)).toBe('capture');
		// A settled frame only consumes acknowledged facts, so the candidate
		// cannot paint a processor that has not started.
		expect(resolveSettledVolumeTone(first)).toBe('native');
		expect(resolveHotkeyVolumeTone({ ...first, prospectiveBoostRoute: 'media-webaudio' })).toBe('native');
		expect(resolveHotkeyVolumeTone({ ...first, boostRoute: 'capture', prospectiveBoostRoute: null })).toBe('native');
		expect(first.actualMode).toBe('bypass');
		expect(first.phase).toBe('idle');
	});

	test('a page-graph Boost owner keeps the crossing blue', () => {
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, boostRoute: 'media-webaudio',
		}))).toBe('native');
		// An explicit null is the same answer as "no route yet".
		expect(resolveHotkeyVolumeTone(facts({ volume: 350, boostRoute: null })))
			.toBe('native');
	});

	test('a live Capture outranks a stale page-graph Boost owner', () => {
		// If the two facts ever disagree, the running processor wins: it is the
		// thing the user is actually hearing.
		expect(resolveHotkeyVolumeTone(facts({
			volume: 350, boostRoute: 'media-webaudio',
			actualMode: 'capture', phase: 'active',
		}))).toBe('capture');
	});

	test('a disabled document never claims a processor it will not start', () => {
		expect(resolveHotkeyVolumeTone(facts({ volume: 350, enabled: false }))).toBe('native');
		expect(resolveSettledVolumeTone(facts({
			volume: 350, enabled: false, actualMode: 'capture', phase: 'active',
		}))).toBe('native');
	});

	test('the settled frame agrees with the gesture frame on acknowledged facts', () => {
		// No prediction is involved here, so the settled repaint can only confirm
		// what the gesture already painted.
		for (const volume of [0, 40, 100, 101, 350]) {
			for (const [actualMode, phase] of [
				['bypass', 'idle'],
				['capture', 'starting'],
				['capture', 'active'],
			] as const) {
				const input = facts({ volume, actualMode, phase });
				expect(resolveSettledVolumeTone(input)).toBe(resolveHotkeyVolumeTone(input));
			}
		}
	});

	test('a settled frame never paints a route it cannot prove', () => {
		for (const volume of [101, 350]) {
			for (const prospectiveBoostRoute of [undefined, 'capture', 'media-webaudio', null] as const) {
				expect(resolveSettledVolumeTone(facts({ volume, prospectiveBoostRoute }))).toBe('native');
			}
			// The last acknowledged Boost owner remains a gesture fallback; it is
			// not evidence that the processor is live right now.
			expect(resolveHotkeyVolumeTone(facts({ volume, boostRoute: 'capture' }))).toBe('capture');
			expect(resolveSettledVolumeTone(facts({ volume, boostRoute: 'capture' }))).toBe('native');
		}
	});
});
