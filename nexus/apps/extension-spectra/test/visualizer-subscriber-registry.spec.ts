import { describe, expect, test } from 'bun:test';
import {
	advanceVisualizerSubscriberLeases,
	planVisualizerSubscriberLease,
	visualizerSubscriberUnion,
	type VisualizerSubscriberLeases,
} from '../src/background/visualizer-subscriber-registry';

function apply(
	current: VisualizerSubscriberLeases,
	subscriberId: string,
	generation: number,
	tabIds: number[],
	now: number,
): VisualizerSubscriberLeases {
	const plan = planVisualizerSubscriberLease(current, {
		subscriberId,
		generation,
		tabIds,
	}, now);
	expect(plan.accepted).toBe(true);
	return plan.candidate;
}

describe('visualizer subscriber leases', () => {
	test('releasing one Popup preserves the other independent consumer', () => {
		let leases: VisualizerSubscriberLeases = new Map();
		leases = apply(leases, 'popup-a', 1, [11], 0);
		leases = apply(leases, 'popup-b', 1, [22], 0);
		expect(visualizerSubscriberUnion(leases).sort()).toEqual([11, 22]);

		leases = apply(leases, 'popup-a', 2, [], 100);
		expect(visualizerSubscriberUnion(leases)).toEqual([22]);
		expect(leases.get('popup-a')?.state).toBe('tombstone');
	});

	test('expires an abnormal exit and rejects a delayed batch resurrection', () => {
		let leases: VisualizerSubscriberLeases = new Map();
		leases = apply(leases, 'popup-a', 4, [11], 0);
		leases = advanceVisualizerSubscriberLeases(leases, 5_001);
		expect(visualizerSubscriberUnion(leases)).toEqual([]);
		expect(leases.get('popup-a')?.state).toBe('tombstone');

		const stale = planVisualizerSubscriberLease(leases, {
			subscriberId: 'popup-a',
			generation: 4,
			tabIds: [11],
		}, 5_002);
		expect(stale.accepted).toBe(false);
		expect(visualizerSubscriberUnion(stale.candidate)).toEqual([]);

		const reacquired = planVisualizerSubscriberLease(stale.candidate, {
			subscriberId: 'popup-a',
			generation: 5,
			tabIds: [11],
		}, 5_003);
		expect(reacquired.accepted).toBe(true);
		expect(visualizerSubscriberUnion(reacquired.candidate)).toEqual([11]);
	});

	test('deletes bounded tombstones after their stale-message window', () => {
		let leases: VisualizerSubscriberLeases = new Map();
		leases = apply(leases, 'popup-a', 2, [], 0);
		expect(advanceVisualizerSubscriberLeases(leases, 29_999).has('popup-a')).toBe(true);
		leases = advanceVisualizerSubscriberLeases(leases, 30_001);
		expect(leases.has('popup-a')).toBe(false);
	});
});
