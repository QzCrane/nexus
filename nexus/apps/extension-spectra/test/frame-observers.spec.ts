import { describe, expect, test } from 'bun:test';
import { createFrameObserverHolder, type FrameObserverPair } from '../src/popup/frame-observers';

function fakeObserver(): FrameObserverPair['resize'] & { disconnected: boolean } {
	return {
		disconnected: false,
		disconnect() {
			this.disconnected = true;
		},
	};
}

function fakePair(): { pair: FrameObserverPair; resize: ReturnType<typeof fakeObserver>; mutation: ReturnType<typeof fakeObserver> } {
	const resize = fakeObserver();
	const mutation = fakeObserver();
	return { pair: { resize, mutation }, resize, mutation };
}

describe('popup frame observers', () => {
	test('keeps exactly one live pair', () => {
		const holder = createFrameObserverHolder();
		expect(holder.live).toBe(false);

		const first = fakePair();
		holder.replace(first.pair);
		expect(holder.live).toBe(true);

		// A Popup that retries its bootstrap tracks the frame again. The previous
		// pair has to go: two live pairs are two writers of the same height, and
		// the one that lost the race keeps a stale measurement alive.
		const second = fakePair();
		holder.replace(second.pair);
		expect(first.resize.disconnected).toBe(true);
		expect(first.mutation.disconnected).toBe(true);
		expect(second.resize.disconnected).toBe(false);
		expect(second.mutation.disconnected).toBe(false);
	});

	test('releasing the frame stops the observers that would resize it', () => {
		const holder = createFrameObserverHolder();
		const pair = fakePair();
		holder.replace(pair.pair);

		holder.release();
		expect(pair.resize.disconnected).toBe(true);
		expect(pair.mutation.disconnected).toBe(true);
		expect(holder.live).toBe(false);
	});

	test('releasing an idle holder is harmless', () => {
		const holder = createFrameObserverHolder();
		holder.release();
		expect(holder.live).toBe(false);
	});
});
