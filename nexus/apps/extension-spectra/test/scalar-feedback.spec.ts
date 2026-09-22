import { describe, expect, test } from 'bun:test';
import {
	resolveHotkeyVolumeBaseline,
	resolveHotkeyReleasePresentation,
	scalarHotkeyGestureSequence,
} from '../src/content/ui/osd';
import {
	scalarFeedbackAnimationDuration,
	scalarFeedbackMaxFrameDelta,
	scalarFeedbackMarkers,
	scalarFeedbackProgress,
} from '../src/content/ui/scalar-feedback';

const volume = (value: number, volumeState: 'native' | 'capture') => ({
	type: 'volume' as const,
	value,
	volumeState,
});

describe('scalar feedback bars', () => {
	test('maps equal numeric deltas to equal visual distances', () => {
		expect(scalarFeedbackProgress('volume', 0)).toBe(0);
		expect(scalarFeedbackProgress('volume', 100)).toBe(12.5);
		expect(scalarFeedbackProgress('volume', 800)).toBe(100);

		const firstSpeedDelta = scalarFeedbackProgress('speed', 2)
			- scalarFeedbackProgress('speed', 1);
		const secondSpeedDelta = scalarFeedbackProgress('speed', 3)
			- scalarFeedbackProgress('speed', 2);
		expect(firstSpeedDelta).toBeCloseTo(secondSpeedDelta, 10);
		expect(scalarFeedbackProgress('speed', 0.1)).toBe(0);
		expect(scalarFeedbackProgress('speed', 16)).toBe(100);
	});

	test('owns the semantic markers for both scalar kinds', () => {
		expect(scalarFeedbackMarkers('volume')).toEqual([
			{ value: 100, label: '100%', lane: 'lower' },
		]);
		expect(scalarFeedbackMarkers('speed')).toEqual([
			{ value: 1, label: '1×', lane: 'lower' },
			{ value: 2, label: '2×', lane: 'upper' },
		]);
	});

	test('animates equivalent shortcut step counts with one shared cadence', () => {
		expect(scalarFeedbackAnimationDuration('volume', 80, 50)).toBe(150);
		expect(scalarFeedbackAnimationDuration('speed', 1, 0.7)).toBeCloseTo(150, 10);
		expect(scalarFeedbackAnimationDuration('volume', 800, 0)).toBe(300);
		expect(scalarFeedbackAnimationDuration('speed', 16, 0.1)).toBe(300);
		expect(scalarFeedbackAnimationDuration('volume', 80, 70, 35)).toBe(35);
		expect(scalarFeedbackAnimationDuration('speed', 1.1, 1.2, 35)).toBe(35);
		expect(scalarFeedbackAnimationDuration('volume', 80, 70, 0)).toBe(16);
		expect(scalarFeedbackAnimationDuration('speed', 1.1, 1.2, 200)).toBe(50);
	});

	test('caps delayed frames by the same fraction of one semantic step', () => {
		expect(scalarFeedbackMaxFrameDelta('volume') / 10).toBeCloseTo(0.6);
		expect(scalarFeedbackMaxFrameDelta('speed') / 0.1).toBeCloseTo(0.6);
	});

	test('starts a new gesture from the lifecycle-correct complete pair', () => {
		const visible = volume(110, 'capture');
		const baseline = volume(100, 'native');
		expect(resolveHotkeyVolumeBaseline(visible, baseline, 'settled')).toEqual(baseline);
		expect(resolveHotkeyVolumeBaseline(visible, baseline, 'active')).toEqual(visible);
	});

	test('orders bootstrap and full-runtime gesture identities through one monotonic sequence', () => {
		expect(scalarHotkeyGestureSequence('default:7')).toBe(7);
		expect(scalarHotkeyGestureSequence('site:8')).toBe(8);
		expect(scalarHotkeyGestureSequence('default:0')).toBeNull();
		expect(scalarHotkeyGestureSequence('forged:9')).toBeNull();
		expect(scalarHotkeyGestureSequence('default:9007199254740992')).toBeNull();
	});

	test('commits the exact final ACK after a frozen optimistic gesture without crossing identities', () => {
		const optimistic = volume(130, 'capture');
		const rejectedActual = volume(100, 'native');
		expect(resolveHotkeyReleasePresentation(
			'default:12',
			'default:12',
			optimistic,
			rejectedActual,
		)).toEqual(rejectedActual);
		expect(resolveHotkeyReleasePresentation(
			'default:13',
			'default:12',
			optimistic,
			rejectedActual,
		)).toBeNull();
	});

});
