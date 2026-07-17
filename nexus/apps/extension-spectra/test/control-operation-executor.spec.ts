import { afterEach, describe, expect, test } from 'bun:test';
import type {
	ControlOperation,
	ControlOperationIntent,
	MediaTarget,
} from '@nexus/contracts';
import type { MediaRegistry } from '../src/content/core/media-registry';
import { setActiveMediaRegistry } from '../src/content/core/media-registry';
import { executeControlOperation } from '../src/content/logic/control-operation-executor';
import type { NativeMediaExecutor } from '../src/content/logic/native-media-executor';
import { disposeABLoops } from '../src/content/video/ab-loop';
import { disposeMarkers } from '../src/content/video/time-marker';

const originalMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
const originalVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalSetTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
const originalClearTimeout = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');

class FakeMediaElement extends EventTarget {
	currentTime = 4;
	duration = 120;
	paused = true;
	ended = false;
	playbackRate = 1;
	seeking = false;
	readonly seekable = { length: 0 } as TimeRanges;
}

const target: MediaTarget = {
	frameId: 0,
	documentId: 'document:operations',
	mediaId: 'media:operations',
	sourceRevision: 0,
	kind: 'audio',
};

const videoTarget: MediaTarget = {
	...target,
	mediaId: 'media:operations-video',
	kind: 'video',
};

afterEach(() => {
	disposeABLoops();
	disposeMarkers();
	restore('HTMLMediaElement', originalMedia);
	restore('HTMLVideoElement', originalVideo);
	restore('document', originalDocument);
	restore('setTimeout', originalSetTimeout);
	restore('clearTimeout', originalClearTimeout);
});

describe('control operation truthfulness', () => {
	test('does not acknowledge marker creation without a resolved media source', async () => {
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => null,
			list: () => [],
		} as unknown as MediaRegistry);
		try {
			await expect(executeControlOperation(
				intent('marker-add', { label: 'intro' }, null),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('No active media source');
		} finally {
			disposeRegistry();
		}
	});

	test('reports the exact remaining marker owner count for lease reconciliation', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		const media = new FakeMediaElement();
		const registry = {
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const disposeRegistry = setActiveMediaRegistry(registry);
		try {
			const added = await executeControlOperation(
				intent('marker-add', { label: 'intro' }, target),
				{} as NativeMediaExecutor,
			);
			expect(added.result).toMatchObject({ remaining: 1 });
			const markerId = (added.result as { marker: { id: string } }).marker.id;
			const removed = await executeControlOperation(
				intent('marker-remove', { id: markerId }, target),
				{} as NativeMediaExecutor,
			);
			expect(removed.result).toEqual({ removed: true, remaining: 0 });
		} finally {
			disposeRegistry();
		}
	});

	test('resolves video-scoped operations from activeVideo instead of activeMedia', async () => {
		const audio = new FakeMediaElement();
		const video = new FakeMediaElement();
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => ({ element: audio as unknown as HTMLMediaElement, target }),
			resolveVideo: () => ({ element: video as unknown as HTMLVideoElement, target: videoTarget }),
			list: () => [],
		} as unknown as MediaRegistry);
		const nativeExecutor = {
			stepFrame: async (operation: ControlOperationIntent<'frame-step'>) => {
				expect(operation.target).toEqual(videoTarget);
				return {
					result: { currentTime: 4.04, frameDuration: 0.04, approximate: true },
					fields: {},
				};
			},
		} as unknown as NativeMediaExecutor;
		try {
			const acknowledgement = await executeControlOperation(
				intent('frame-step', { direction: 1 }, null),
				nativeExecutor,
			);
			expect(acknowledgement.target).toEqual(videoTarget);
		} finally {
			disposeRegistry();
		}
	});

	test('keeps a document observation ACK targetless even when it reads active media', async () => {
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { body: null },
		});
		const media = new FakeMediaElement();
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry);
		const nativeExecutor = {
			readMediaSummary: () => ({ playing: false, speed: 1, currentTime: 4 }),
		} as unknown as NativeMediaExecutor;
		try {
			const acknowledgement = await executeControlOperation(
				intent('show-info', {}, null),
				nativeExecutor,
			);
			expect(acknowledgement.target).toBeNull();
			expect(acknowledgement.strategy).toBe('observe');
		} finally {
			disposeRegistry();
		}
	});

	test('returns structured operation failure for unresolved marker jumps/removal and A/B skip', async () => {
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => null,
			list: () => [],
		} as unknown as MediaRegistry);
		try {
			await expect(executeControlOperation(
				intent('marker-remove', { id: 'm_missing' }, null),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('marker does not exist');
			await expect(executeControlOperation(
				intent('marker-jump', { id: 'm_missing' }, null),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('marker does not exist');
			await expect(executeControlOperation(
				intent('marker-jump-next', {}, null),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('No adjacent marker');
			await expect(executeControlOperation(
				intent('ab-skip', {}, null),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('No complete A/B loop');
		} finally {
			disposeRegistry();
		}
	});

	test('acknowledges source-removal A/B cleanup against the retired source identity', async () => {
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => null,
			list: () => [],
		} as unknown as MediaRegistry);
		try {
			const acknowledgement = await executeControlOperation(
				intent('ab-clear', {}, target),
				{} as NativeMediaExecutor,
			);
			expect(acknowledgement.target).toEqual(target);
			expect(acknowledgement.fields.abLoop).toMatchObject({
				actual: { pointA: null, pointB: null, enabled: false },
				phase: 'applied',
				controlled: false,
			});
	} finally {
			disposeRegistry();
		}
	});

	test('rejects an invalid B point instead of returning a controlled empty loop', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		const media = new FakeMediaElement();
		const registry = {
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const disposeRegistry = setActiveMediaRegistry(registry);
		try {
			await executeControlOperation(
				intent('ab-set-a', {}, target),
				{} as NativeMediaExecutor,
			);
			media.currentTime += 0.05;
			await expect(executeControlOperation(
				intent('ab-set-b', {}, target),
				{} as NativeMediaExecutor,
			)).rejects.toThrow('at least 0.1 seconds');
		} finally {
			disposeRegistry();
		}
	});

	test('uses native seek readback for adjacent-marker result and currentTime field ACK', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		const media = new FakeMediaElement();
		let readbackTime = 0;
		Object.defineProperty(media, 'currentTime', {
			configurable: true,
			get: () => readbackTime,
			set: (value: number) => {
				readbackTime = value + 0.01;
			},
		});
		const registry = {
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const disposeRegistry = setActiveMediaRegistry(registry);
		try {
			media.currentTime = 20;
			const added = await executeControlOperation(
				intent('marker-add', { label: 'actual-readback' }, target),
				{} as NativeMediaExecutor,
			);
			const markerTime = (added.result as { marker: { time: number } }).marker.time;
			media.currentTime = 0;
			const jumped = await executeControlOperation(
				intent('marker-jump-next', {}, target),
				{} as NativeMediaExecutor,
			);
			const result = jumped.result as {
				jumped: boolean;
				actualTime: number | null;
				marker: { time: number } | null;
			};
			expect(result.jumped).toBe(true);
			expect(result.marker?.time).toBe(markerTime);
			expect(result.actualTime).toBeCloseTo(markerTime + 0.01, 8);
			expect(jumped.fields.currentTime).toMatchObject({
				desired: result.actualTime,
				actual: result.actualTime,
				strategy: 'dom-native',
			});
		} finally {
			disposeRegistry();
		}
	});

	test('keeps A/B skip beyond B and acknowledges the exact native seek readback', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		const timers = new Map<number, () => void>();
		let nextTimerId = 0;
		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			value: (callback: () => void) => {
				const id = ++nextTimerId;
				timers.set(id, callback);
				return id;
			},
		});
		Object.defineProperty(globalThis, 'clearTimeout', {
			configurable: true,
			value: (id: number) => timers.delete(id),
		});
		const media = new FakeMediaElement();
		media.paused = false;
		let readbackTime = 0;
		Object.defineProperty(media, 'currentTime', {
			configurable: true,
			get: () => readbackTime,
			set: (value: number) => {
				readbackTime = value + 0.01;
			},
		});
		const registry = {
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const disposeRegistry = setActiveMediaRegistry(registry);
		try {
			media.currentTime = 1;
			await executeControlOperation(intent('ab-set-a', {}, target), {} as NativeMediaExecutor);
			media.currentTime = 2;
			await executeControlOperation(intent('ab-set-b', {}, target), {} as NativeMediaExecutor);
			await Promise.resolve();
			await Promise.resolve();

			const skipped = await executeControlOperation(
				intent('ab-skip', {}, target),
				{} as NativeMediaExecutor,
			);
			const result = skipped.result as {
				skipped: boolean;
				currentTime: number | null;
			};
			expect(result.skipped).toBe(true);
			expect(result.currentTime).toBe(readbackTime);
			expect(skipped.fields.currentTime?.actual).toBe(readbackTime);

			media.dispatchEvent(new Event('seeked'));
			expect(timers.size).toBe(0);
			expect(media.currentTime).toBe(result.currentTime);
		} finally {
			disposeRegistry();
		}
	});

	test('uses the bounded timer backup when hidden video frame callbacks stop', async () => {
		class FakeFrameVideoElement extends FakeMediaElement {
			private nextFrameId = 0;
			readonly frameCallbacks = new Map<number, VideoFrameRequestCallback>();

			requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
				const id = ++this.nextFrameId;
				this.frameCallbacks.set(id, callback);
				return id;
			}

			cancelVideoFrameCallback(id: number): void {
				this.frameCallbacks.delete(id);
			}
		}
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeFrameVideoElement,
		});
		const timers = new Map<number, () => void>();
		let nextTimerId = 0;
		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			value: (callback: () => void) => {
				const id = ++nextTimerId;
				timers.set(id, callback);
				return id;
			},
		});
		Object.defineProperty(globalThis, 'clearTimeout', {
			configurable: true,
			value: (id: number) => timers.delete(id),
		});
		const video = new FakeFrameVideoElement();
		video.paused = false;
		const registry = {
			resolve: () => ({ element: video as unknown as HTMLVideoElement, target: videoTarget }),
			resolveVideo: () => ({ element: video as unknown as HTMLVideoElement, target: videoTarget }),
			list: () => [{ element: video as unknown as HTMLVideoElement, target: videoTarget }],
		} as unknown as MediaRegistry;
		const disposeRegistry = setActiveMediaRegistry(registry);
		try {
			video.currentTime = 0;
			await executeControlOperation(intent('ab-set-a', {}, videoTarget), {} as NativeMediaExecutor);
			video.currentTime = 1;
			await executeControlOperation(intent('ab-set-b', {}, videoTarget), {} as NativeMediaExecutor);
			await Promise.resolve();
			await Promise.resolve();
			expect(timers.size).toBe(1);

			video.currentTime = 0.95;
			fireOnlyTimer(timers);
			expect(video.frameCallbacks.size).toBe(1);
			expect(timers.size).toBe(1);

			// The rVFC callback intentionally never fires, matching a hidden tab.
			video.currentTime = 1.01;
			fireOnlyTimer(timers);
			await Promise.resolve();
			await Promise.resolve();
			expect(video.frameCallbacks.size).toBe(0);
			expect(video.currentTime).toBe(0);
		} finally {
			disposeRegistry();
		}
	});
});

function intent<O extends ControlOperation>(
	operation: O,
	payload: unknown,
	mediaTarget: MediaTarget | null,
): ControlOperationIntent<O> {
	return {
		operationId: `operation:${operation}`,
		tabId: 7,
		documentId: target.documentId,
		generation: 1,
		baseRevision: 2,
		source: 'popup',
		target: mediaTarget,
		operation,
		payload,
	} as ControlOperationIntent<O>;
}

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

function fireOnlyTimer(timers: Map<number, () => void>): void {
	expect(timers.size).toBe(1);
	const [id, callback] = [...timers.entries()][0]!;
	timers.delete(id);
	callback();
}
