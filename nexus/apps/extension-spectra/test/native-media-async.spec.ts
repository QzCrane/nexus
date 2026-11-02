import { describe, expect, test } from 'bun:test';
import {
	consumeOwnedSeek,
	nativeValuesMatch,
	seekNativeMedia,
	writeSpeedWithSettleAck,
	writeWithStableEventAck,
} from '../src/content/logic/native-media-async';

class FakeMediaElement extends EventTarget {
	currentTime = 0;
	duration = 30;
	seeking = true;
	readonly seekable = { length: 0 } as TimeRanges;
}

describe('bounded native-media async capability', () => {
	test('uses one matcher for numeric tolerance and exact structured native values', () => {
		expect(nativeValuesMatch(1, 1.009, 0.01)).toBe(true);
		expect(nativeValuesMatch(1, 1.011, 0.01)).toBe(false);
		expect(nativeValuesMatch([1, 2], [1, 2], 0)).toBe(true);
		expect(nativeValuesMatch([1, 2], [2, 1], 0)).toBe(false);
	});

	test('settles a pending seek immediately when its operation is cancelled', async () => {
		const media = new FakeMediaElement();
		const controller = new AbortController();
		const operation = seekNativeMedia(
			media as unknown as HTMLMediaElement,
			10,
			0.05,
			{ signal: controller.signal },
		);

		controller.abort();

		await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
	});

	test('keeps a synchronous seek acknowledgement token for the late native event', async () => {
		const media = new FakeMediaElement();
		media.seeking = false;
		const actual = await seekNativeMedia(
			media as unknown as HTMLMediaElement,
			12,
			0.05,
		);

		expect(actual).toBe(12);
		expect(consumeOwnedSeek(media as unknown as HTMLMediaElement, 12)).toBe(true);
		expect(consumeOwnedSeek(media as unknown as HTMLMediaElement, 12)).toBe(false);
	});

	test('does not turn a getter-only native write into a successful event ACK', async () => {
		const target = new EventTarget();
		const actual = 0;

		const operation = writeWithStableEventAck(
			target,
			'volumechange',
			() => undefined,
			() => actual,
			1,
			0,
			5,
		);

		await expect(operation).rejects.toThrow('did not acknowledge');
	});

	test.each(['timeout', 'abort', 'accepted'] as const)('settles a native operation whose write Promise never completes (%s)', async (outcome) => {
		const target = new EventTarget();
		const controller = new AbortController();
		let actual = false;
		const operation = writeWithStableEventAck(target, 'play', () => {
			if (outcome === 'accepted') {
				actual = true;
				target.dispatchEvent(new Event('play'));
			}
			return new Promise<void>(() => undefined);
		}, () => actual, true, 0, outcome === 'accepted' ? 250 : 15, { signal: controller.signal });
		if (outcome === 'abort') controller.abort();
		const bounded = Promise.race([operation, new Promise<string>((resolve) => setTimeout(() => resolve('hung write'), 300))]);
		if (outcome === 'accepted') expect(await bounded).toBe(true);
		else if (outcome === 'abort') await expect(bounded).rejects.toMatchObject({ code: 'cancelled' });
		else await expect(bounded).rejects.toThrow('did not acknowledge');
	}, 500);

	test('preserves an immediate native write rejection and handles a rejection after event proof', async () => {
		const denied = new DOMException('Gesture required', 'NotAllowedError');
		await expect(writeWithStableEventAck(new EventTarget(), 'play', () => Promise.reject(denied),
			() => false, true, 0)).rejects.toBe(denied);
		const target = new EventTarget();
		let actual = false;
		let rejectWrite!: (error: Error) => void;
		const accepted = writeWithStableEventAck(target, 'play', () => {
			actual = true;
			target.dispatchEvent(new Event('play'));
			return new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
		}, () => actual, true, 0);
		expect(await Promise.race([accepted, new Promise<null>((resolve) => setTimeout(() => resolve(null), 300))])).toBe(true);
		rejectWrite(new Error('Later pause interrupted the play promise'));
		await Promise.resolve();
	});
});

describe('speed settle acknowledgement', () => {
	test('settles when the value is already in effect without a ratechange event', async () => {
		let value = 1.5;
		const actual = await writeSpeedWithSettleAck(
			() => { value = 1.5; },
			() => value,
			1.5,
			0.01,
			300,
		);
		expect(actual).toBe(1.5);
	});

	test('settles a write whose value lands a few polls later', async () => {
		let value = 1;
		const actual = await writeSpeedWithSettleAck(
			() => { setTimeout(() => { value = 2; }, 40); },
			() => value,
			2,
			0.01,
			400,
		);
		expect(actual).toBe(2);
	});

	test('rejects when the page never honors the requested rate', async () => {
		const actual = await writeSpeedWithSettleAck(
			() => undefined,
			() => 1,
			1.75,
			0.01,
			120,
		).then(() => 'resolved').catch((error) => (error as Error).message);
		expect(actual).toMatch(/did not settle/);
	});

	test('is cancelled by its operation signal rather than timing out', async () => {
		const controller = new AbortController();
		const operation = writeSpeedWithSettleAck(
			() => undefined,
			() => 1,
			1.5,
			0.01,
			3000,
			{ signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 20);
		await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
	});
});
