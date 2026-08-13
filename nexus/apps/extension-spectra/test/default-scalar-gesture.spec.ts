import { describe, expect, test } from 'bun:test';
import {
	nextScalarGestureId,
	isHotkeyGestureReleased,
	publishDefaultScalarGesture,
	publishHotkeyActualFeedback,
	publishPhysicalHotkeyRelease,
	subscribeHotkeyReplay,
	subscribePhysicalHotkeyRelease,
	type DefaultScalarGestureSignal,
	type PhysicalHotkeyReleaseSignal,
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

		const firstSubscriber: unknown[] = [];
		const unsubscribeFirst = subscribeHotkeyReplay((value) => {
			firstSubscriber.push(value);
		});
		expect(firstSubscriber).toEqual([{ type: 'gesture', signal }]);
		unsubscribeFirst();

		const secondSubscriber: unknown[] = [];
		const unsubscribeSecond = subscribeHotkeyReplay((value) => {
			secondSubscriber.push(value);
		});
		expect(secondSubscriber).toEqual([]);

		const release = { ...signal, phase: 'release' as const };
		publishDefaultScalarGesture(release);
		expect(secondSubscriber).toEqual([{ type: 'gesture', signal: release }]);
		unsubscribeSecond();
	});

	test('keeps physical releases live-only', () => {
		const release = { code: 'KeyK' };
		publishPhysicalHotkeyRelease(release);

		const received: PhysicalHotkeyReleaseSignal[] = [];
		const unsubscribe = subscribePhysicalHotkeyRelease((value) => received.push(value));
		expect(received).toEqual([]);
		publishPhysicalHotkeyRelease(release);
		expect(received).toEqual([release]);
		unsubscribe();
		publishPhysicalHotkeyRelease({ code: 'AltLeft' });
		expect(received).toEqual([release]);
	});

	test('replays gestures and exact background feedback in original document order', () => {
		const gesture: DefaultScalarGestureSignal = {
			action: 'volume_up',
			gesture: nextScalarGestureId('default'),
			phase: 'press',
			repeated: false,
		};
		const message = {
			protocolVersion: 2,
			type: 'spectra.hotkey.target.feedback',
			payload: { gesture: gesture.gesture },
		};
		publishDefaultScalarGesture(gesture);
		publishHotkeyActualFeedback(message);
		publishDefaultScalarGesture({ ...gesture, phase: 'release' });
		publishDefaultScalarGesture({ ...gesture, phase: 'settled' });

		const first: unknown[] = [];
		const unsubscribeFirst = subscribeHotkeyReplay((value) => first.push(value));
		expect(first).toEqual([
			{ type: 'gesture', signal: gesture },
			{ type: 'feedback', message },
			{ type: 'gesture', signal: { ...gesture, phase: 'release' } },
			{ type: 'gesture', signal: { ...gesture, phase: 'settled' } },
		]);
		unsubscribeFirst();

		const second: unknown[] = [];
		const unsubscribeSecond = subscribeHotkeyReplay((value) => second.push(value));
		expect(second).toEqual([]);
		unsubscribeSecond();
	});

	test('keeps the ordered V4 owner isolated from an in-page legacy V3 channel', () => {
		const legacyListener = () => undefined;
		const legacy = {
			version: 3,
			sequence: 91,
			listeners: new Set([legacyListener]),
			pending: [{ action: 'volume_down', phase: 'press' }],
			releaseListeners: new Set(),
		};
		const globals = globalThis as typeof globalThis & Record<string, unknown>;
		globals.__spectraHotkeyGestureV3 = legacy;
		Reflect.deleteProperty(globals, '__spectraHotkeyGestureV4');

		const signal: DefaultScalarGestureSignal = {
			action: 'volume_up',
			gesture: nextScalarGestureId('default'),
			phase: 'press',
			repeated: false,
		};
		publishDefaultScalarGesture(signal);
		const replayed: unknown[] = [];
		const unsubscribe = subscribeHotkeyReplay((value) => replayed.push(value));

		expect(replayed).toEqual([{ type: 'gesture', signal }]);
		expect(Number(signal.gesture.split(':')[1])).toBe(92);
		expect(legacy.pending).toEqual([{ action: 'volume_down', phase: 'press' }]);
		expect(legacy.listeners).toEqual(new Set([legacyListener]));
		unsubscribe();
		Reflect.deleteProperty(globals, '__spectraHotkeyGestureV3');
	});

	test('retains a bounded physical-release watermark across runtime replacement', () => {
		const gesture = nextScalarGestureId('default');
		expect(isHotkeyGestureReleased(gesture)).toBe(false);
		publishDefaultScalarGesture({
			action: 'volume_down', gesture, phase: 'release', repeated: false,
		});
		expect(isHotkeyGestureReleased(gesture)).toBe(true);
		expect(isHotkeyGestureReleased(`default:${Number(gesture.split(':')[1]) + 1}`)).toBe(false);
	});
});
