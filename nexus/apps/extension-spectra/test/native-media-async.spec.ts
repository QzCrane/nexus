import { describe, expect, test } from 'bun:test';
import {
	consumeOwnedSeek,
	seekNativeMedia,
	writeWithStableEventAck,
} from '../src/content/logic/native-media-async';

class FakeMediaElement extends EventTarget {
	currentTime = 0;
	duration = 30;
	seeking = true;
	readonly seekable = { length: 0 } as TimeRanges;
}

describe('bounded native-media async capability', () => {
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
});
