import { describe, expect, test } from 'bun:test';
import {
	playDashStreams,
	startDashStreams,
} from '../src/tools/hover-zoom/content/viewer/mse-player';
import { MSESessionOwner } from '../src/tools/hover-zoom/content/viewer/mse-session-owner';

type Listener = EventListenerOrEventListenerObject;

class FakeEventTarget {
	private readonly listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener | null): void {
		if (!listener) return;
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: Listener | null): void {
		if (!listener) return;
		this.listeners.get(type)?.delete(listener);
	}

	protected emit(type: string): void {
		const event = new Event(type);
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			if (typeof listener === 'function') listener(event);
			else listener.handleEvent(event);
		}
	}

	listenerCount(): number {
		let count = 0;
		for (const listeners of this.listeners.values()) count += listeners.size;
		return count;
	}
}

class FakeSourceBuffer extends FakeEventTarget {
	updating = false;
	autoComplete = true;

	appendBuffer(): void {
		this.updating = true;
		if (!this.autoComplete) return;
		queueMicrotask(() => {
			if (!this.updating) return;
			this.updating = false;
			this.emit('updateend');
		});
	}

	abort(): void {
		if (!this.updating) return;
		this.updating = false;
		this.emit('abort');
	}
}

class FakeMediaSource extends FakeEventTarget {
	readyState: 'closed' | 'open' | 'ended' = 'closed';
	readonly buffers: FakeSourceBuffer[] = [];
	endCount = 0;
	failAddSourceBuffer = false;

	open(): void {
		this.readyState = 'open';
		this.emit('sourceopen');
	}

	addSourceBuffer(): SourceBuffer {
		if (this.failAddSourceBuffer) throw new Error('addSourceBuffer failed');
		const buffer = new FakeSourceBuffer();
		this.buffers.push(buffer);
		return buffer as unknown as SourceBuffer;
	}

	endOfStream(): void {
		if (this.readyState !== 'open') throw new Error('MediaSource is not open');
		if (this.buffers.some((buffer) => buffer.updating)) {
			throw new Error('SourceBuffer is updating');
		}
		this.readyState = 'ended';
		this.endCount++;
	}
}

type FetchSegment = (
	url: string,
	headers?: Record<string, string>,
	signal?: AbortSignal,
) => Promise<ArrayBuffer>;

async function waitUntil(
	predicate: () => boolean,
	message: string,
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error(message);
}

function createHarness(fetchSegment: FetchSegment) {
	const mediaSource = new FakeMediaSource();
	const revokedUrls: string[] = [];
	const video = { src: '' } as HTMLVideoElement;
	const dependencies = {
		isSupported: () => true,
		createMediaSource: () => mediaSource as unknown as MediaSource,
		createObjectUrl: () => {
			queueMicrotask(() => mediaSource.open());
			return 'blob:halo-mse-test';
		},
		revokeObjectUrl: (url: string) => revokedUrls.push(url),
		fetchSegment,
	};
	return { dependencies, mediaSource, revokedUrls, video };
}

describe('MSE player lifecycle', () => {
	test('retires an initializing session before a stale completion can reclaim ownership', async () => {
		let resolveFirst: (() => void) | undefined;
		let resolveSecond: (() => void) | undefined;
		const firstReady = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const secondReady = new Promise<void>((resolve) => {
			resolveSecond = resolve;
		});
		let firstDisposeCount = 0;
		let secondDisposeCount = 0;
		let firstReadyCount = 0;
		let secondReadyCount = 0;
		let secondIsCurrent: (() => boolean) | undefined;
		const owner = new MSESessionOwner();

		owner.replace(
			{ ready: firstReady, dispose: () => { firstDisposeCount++; } },
			{ onReady: () => { firstReadyCount++; }, onFailure: () => {} },
		);
		owner.replace(
			{ ready: secondReady, dispose: () => { secondDisposeCount++; } },
			{
				onReady: (isCurrent) => {
					secondIsCurrent = isCurrent;
					secondReadyCount++;
				},
				onFailure: () => {},
			},
		);

		expect(firstDisposeCount).toBe(1);
		resolveFirst?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(firstReadyCount).toBe(0);
		expect(secondReadyCount).toBe(0);

		resolveSecond?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(secondReadyCount).toBe(1);
		expect(secondIsCurrent?.()).toBe(true);

		owner.retire();
		owner.retire();
		expect(firstDisposeCount).toBe(1);
		expect(secondDisposeCount).toBe(1);
		expect(secondIsCurrent?.()).toBe(false);
	});

	test('ignores a stale failure without retiring the replacement session', async () => {
		let rejectFirst: ((error: Error) => void) | undefined;
		let resolveSecond: (() => void) | undefined;
		const firstReady = new Promise<void>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const secondReady = new Promise<void>((resolve) => {
			resolveSecond = resolve;
		});
		let firstDisposeCount = 0;
		let secondDisposeCount = 0;
		let staleFailureCount = 0;
		let secondReadyCount = 0;
		const owner = new MSESessionOwner();

		owner.replace(
			{ ready: firstReady, dispose: () => { firstDisposeCount++; } },
			{
				onReady: () => {},
				onFailure: () => { staleFailureCount++; },
			},
		);
		owner.replace(
			{ ready: secondReady, dispose: () => { secondDisposeCount++; } },
			{
				onReady: () => { secondReadyCount++; },
				onFailure: () => {},
			},
		);

		rejectFirst?.(new Error('stale failure'));
		await Promise.resolve();
		await Promise.resolve();
		expect(staleFailureCount).toBe(0);
		expect(firstDisposeCount).toBe(1);
		expect(secondDisposeCount).toBe(0);

		resolveSecond?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(secondReadyCount).toBe(1);
	});

	test('retires the current session when its readiness callback fails', async () => {
		const owner = new MSESessionOwner();
		let disposeCount = 0;
		const failures: unknown[] = [];

		owner.replace(
			{
				ready: Promise.resolve(),
				dispose: () => { disposeCount++; },
			},
			{
				onReady: () => {
					throw new Error('metadata callback failed');
				},
				onFailure: (error) => { failures.push(error); },
			},
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(disposeCount).toBe(1);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toEqual(new Error('metadata callback failed'));

		owner.retire();
		expect(disposeCount).toBe(1);
	});

	test('can dispose while the initial segment fetch is still unresolved', async () => {
		let fetchStarted = false;
		let observedSignal: AbortSignal | undefined;
		const harness = createHarness((_url, _headers, signal) => {
			fetchStarted = true;
			observedSignal = signal;
			return new Promise<ArrayBuffer>(() => {});
		});

		const session = startDashStreams(
			harness.video,
			'https://example.test/video.m4s',
			undefined,
			undefined,
			undefined,
			harness.dependencies,
		);
		await waitUntil(
			() => fetchStarted,
			'Initial segment fetch did not start',
		);
		expect(fetchStarted).toBe(true);

		session.dispose();
		session.dispose();
		expect(observedSignal?.aborted).toBe(true);
		expect(harness.revokedUrls).toEqual(['blob:halo-mse-test']);
		await expect(session.ready).rejects.toMatchObject({ name: 'AbortError' });
	});

	test('finishes a video-only stream without retaining listeners or polling', async () => {
		let fetchCount = 0;
		const harness = createHarness(async () => {
			fetchCount++;
			return new ArrayBuffer(1);
		});

		const cleanup = await playDashStreams(
			harness.video,
			'https://example.test/video.m4s',
			undefined,
			undefined,
			undefined,
			harness.dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fetchCount).toBe(1);
		expect(harness.mediaSource.endCount).toBe(1);
		expect(harness.mediaSource.buffers[0]?.listenerCount()).toBe(0);
		expect(harness.revokedUrls).toEqual([]);

		cleanup();
		cleanup();
		expect(harness.revokedUrls).toEqual(['blob:halo-mse-test']);
	});

	test('rejects an initial fetch failure and revokes its object URL once', async () => {
		const harness = createHarness(async () => {
			throw new Error('initial fetch failed');
		});

		await expect(playDashStreams(
			harness.video,
			'https://example.test/video.m4s',
			undefined,
			undefined,
			undefined,
			harness.dependencies,
		)).rejects.toThrow('initial fetch failed');

		expect(harness.revokedUrls).toEqual(['blob:halo-mse-test']);
		expect(harness.mediaSource.buffers[0]?.listenerCount()).toBe(0);
	});

	test('revokes the object URL when SourceBuffer creation fails', async () => {
		const harness = createHarness(async () => new ArrayBuffer(1));
		harness.mediaSource.failAddSourceBuffer = true;

		await expect(playDashStreams(
			harness.video,
			'https://example.test/video.m4s',
			undefined,
			undefined,
			undefined,
			harness.dependencies,
		)).rejects.toThrow('addSourceBuffer failed');

		expect(harness.revokedUrls).toEqual(['blob:halo-mse-test']);
	});

	test('aborts an in-flight append and releases its listeners during cleanup', async () => {
		let fetchCount = 0;
		let resolveBackgroundFetch: ((value: ArrayBuffer) => void) | undefined;
		const harness = createHarness(() => {
			fetchCount++;
			if (fetchCount === 1) return Promise.resolve(new ArrayBuffer(768 * 1024));
			return new Promise<ArrayBuffer>((resolve) => {
				resolveBackgroundFetch = resolve;
			});
		});

		const cleanup = await playDashStreams(
			harness.video,
			'https://example.test/video.m4s',
			undefined,
			undefined,
			undefined,
			harness.dependencies,
		);
		const buffer = harness.mediaSource.buffers[0];
		expect(buffer).toBeDefined();
		if (!buffer || !resolveBackgroundFetch) {
			throw new Error('Background append was not admitted');
		}
		buffer.autoComplete = false;
		resolveBackgroundFetch(new ArrayBuffer(1));
		await Promise.resolve();
		await Promise.resolve();
		expect(buffer.updating).toBe(true);

		cleanup();
		await Promise.resolve();

		expect(buffer.updating).toBe(false);
		expect(buffer.listenerCount()).toBe(0);
		expect(harness.revokedUrls).toEqual(['blob:halo-mse-test']);
	});
});
