import { describe, expect, test } from 'bun:test';
import {
	nextScalarGestureId,
	publishDefaultScalarGesture,
	subscribeDefaultScalarGesture,
	type DefaultScalarGestureSignal,
} from '../src/content/input/default-scalar-gesture';

describe('default scalar gesture channel', () => {
	test('keeps gesture identities monotonic across owners', () => {
		const first = Number(nextScalarGestureId('default').split(':')[1]);
		const second = Number(nextScalarGestureId('site').split(':')[1]);
		expect(second).toBe(first + 1);
	});

	test('replays cold-bootstrap signals once when the feedback runtime mounts', () => {
		const signal: DefaultScalarGestureSignal = {
			action: 'volume_down',
			gesture: nextScalarGestureId('default'),
			phase: 'press',
			repeated: false,
		};
		publishDefaultScalarGesture(signal);

		const firstSubscriber: DefaultScalarGestureSignal[] = [];
		const unsubscribeFirst = subscribeDefaultScalarGesture((value) => {
			firstSubscriber.push(value);
		});
		expect(firstSubscriber).toEqual([signal]);
		unsubscribeFirst();

		const secondSubscriber: DefaultScalarGestureSignal[] = [];
		const unsubscribeSecond = subscribeDefaultScalarGesture((value) => {
			secondSubscriber.push(value);
		});
		expect(secondSubscriber).toEqual([]);

		const release = { ...signal, phase: 'release' as const };
		publishDefaultScalarGesture(release);
		expect(secondSubscriber).toEqual([release]);
		unsubscribeSecond();
	});
});
