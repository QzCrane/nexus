import { afterEach, describe, expect, test } from 'bun:test';
import type { ControlIntent, MediaTarget } from '@nexus/contracts';
import {
	ContentLifecycleError,
	DocumentRuntimeContext,
	sameMediaTarget,
} from '../src/content/core/content-runtime-context';
import { disposeContentRuntimeLifecycle } from '../src/content/core/content-runtime-lifecycle';
import { NativeMediaExecutor } from '../src/content/logic/native-media-executor';
import { seekNativeMedia } from '../src/content/logic/native-media-async';
import { setActiveMediaRegistry, type MediaRegistry } from '../src/content/core/media-registry';
import { addMarker, disposeMarkers } from '../src/content/video/time-marker';
import { disposeABLoops, listABOwnership, setPointA } from '../src/content/video/ab-loop';
import { VideoEffectsController } from '../src/content/video/video-effects-controller';

const originalHtmlMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
const originalHtmlVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalHtmlElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalComputed = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const originalCancelRaf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');

const target: MediaTarget = {
	frameId: 0,
	documentId: 'document:lifecycle',
	mediaId: 'media:lifecycle',
	sourceRevision: 0,
	kind: 'audio',
};

class PendingSeekMedia extends EventTarget {
	currentTime = 0;
	duration = 120;
	paused = true;
	ended = false;
	seeking = true;
	playbackRate = 1;
	loop = false;
	readonly seekable = { length: 0 } as TimeRanges;
}

afterEach(() => {
	disposeABLoops();
	disposeMarkers();
	restore('HTMLMediaElement', originalHtmlMedia);
	restore('HTMLVideoElement', originalHtmlVideo);
	restore('HTMLElement', originalHtmlElement);
	restore('document', originalDocument);
	restore('window', originalWindow);
	restore('getComputedStyle', originalComputed);
	restore('ResizeObserver', originalResizeObserver);
	restore('requestAnimationFrame', originalRaf);
	restore('cancelAnimationFrame', originalCancelRaf);
});

describe('content lifecycle fences', () => {
	test('aborts the document scope before awaiting release and always finalizes', async () => {
		const context = new DocumentRuntimeContext({ documentId: target.documentId, frameId: 0 });
		let releaseResolve: (() => void) | undefined;
		const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
		const order: string[] = [];
		context.signal.addEventListener('abort', () => order.push('context:abort'), { once: true });

		const disposal = disposeContentRuntimeLifecycle({
			context,
			handoff: false,
			disposeSynchronous: () => order.push('owners:dispose'),
			release: async () => {
				order.push('release:start');
				await release;
				order.push('release:end');
			},
			finalize: () => order.push('runtime:finalize'),
		});

		expect(context.signal.aborted).toBe(true);
		expect(order).toEqual(['context:abort', 'owners:dispose', 'release:start']);
		releaseResolve?.();
		await disposal;
		expect(order).toEqual([
			'context:abort',
			'owners:dispose',
			'release:start',
			'release:end',
			'runtime:finalize',
		]);

		const rejectedContext = new DocumentRuntimeContext({
			documentId: 'document:release-reject',
			frameId: 0,
		});
		let finalized = false;
		await expect(disposeContentRuntimeLifecycle({
			context: rejectedContext,
			handoff: false,
			disposeSynchronous: () => undefined,
			release: async () => { throw new Error('physical release failed'); },
			finalize: () => { finalized = true; },
		})).rejects.toThrow('physical release failed');
		expect(rejectedContext.signal.aborted).toBe(true);
		expect(finalized).toBe(true);
	});

	test('requires immutable non-empty document identity and rejects another document target', () => {
		expect(() => new DocumentRuntimeContext({ documentId: target.documentId, frameId: 1 }))
			.toThrow(/top-level document/iu);
		const context = new DocumentRuntimeContext({ documentId: target.documentId, frameId: 0 });
		const fence = context.capture(target);
		expect(fence.target).toEqual(target);
		expect(sameMediaTarget(fence.target, target)).toBe(true);
		expect(() => context.assertFence(fence, { ...target, documentId: 'document:two' }))
			.toThrow(ContentLifecycleError);
		context.dispose();
		expect(() => context.capture(target)).toThrow(/lifecycle has ended/iu);
	});

	test('settles a native seek immediately when its source fence is invalidated', async () => {
		const media = new PendingSeekMedia();
		let current = true;
		const operation = seekNativeMedia(media as unknown as HTMLMediaElement, 10, 0.05, {
			isCurrent: () => current,
		});
		current = false;
		media.dispatchEvent(new Event('seeked'));
		await expect(operation).rejects.toMatchObject({ code: 'stale-media-source' });
	});

	test('executor disposal aborts a pending target-bound seek with a typed cancellation', async () => {
		const media = new PendingSeekMedia();
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});
		const registry = {
			subscribe: () => () => undefined,
			resolve: (requested: MediaTarget | null) => requested?.mediaId === target.mediaId
				? { element: media as unknown as HTMLMediaElement, target }
				: null,
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const executor = new NativeMediaExecutor(registry);
		const intent: ControlIntent = {
			intentId: 'intent:lifecycle',
			tabId: 1,
			documentId: target.documentId,
			generation: 1,
			baseRevision: 1,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			actualContext: {},
			patch: { currentTime: 10 },
		};
		const operation = executor.execute(intent);
		executor.dispose();
		await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
	});

	test('marker admission rejects a non-finite media timeline value', () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: PendingSeekMedia,
		});
		const media = new PendingSeekMedia();
		media.currentTime = Number.NaN;
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry);
		try {
			expect(() => addMarker('bad', target)).toThrow(/outside the current media timeline/iu);
		} finally {
			disposeRegistry();
		}
	});

	test('A-only state is not reported as an active loop owner', () => {
		const media = new PendingSeekMedia();
		const disposeRegistry = setActiveMediaRegistry({
			resolve: () => ({ element: media as unknown as HTMLMediaElement, target }),
			list: () => [{ element: media as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry);
		try {
			expect(setPointA(target)).toBe(0);
			expect(listABOwnership()).toEqual([{ target, active: false }]);
		} finally {
			disposeRegistry();
		}
	});

	test('dim readback rejects when controller disposal ends the pending rAF', async () => {
		class FakeStyle {
			private readonly values = new Map<string, string>();
			cssText = '';
			left = '';
			top = '';
			width = '';
			height = '';
			opacity = '';
			setProperty(name: string, value: string): void { this.values.set(name, value); }
			removeProperty(name: string): string { const value = this.values.get(name) ?? ''; this.values.delete(name); return value; }
			getPropertyValue(name: string): string { return this.values.get(name) ?? ''; }
			getPropertyPriority(): string { return ''; }
		}
		class FakeDomElement {
			readonly dataset: Record<string, string> = {};
			readonly style = new FakeStyle();
			parentElement: FakeDomElement | null = null;
			isConnected = false;
			clientWidth = 1280;
			clientHeight = 720;
			appendChild(child: FakeDomElement): FakeDomElement { child.parentElement = this; child.isConnected = true; return child; }
			attachShadow(): FakeDomElement { return new FakeDomElement(); }
			contains(): boolean { return false; }
			remove(): void { this.isConnected = false; }
		}
		class FakeVideo extends FakeDomElement {
			clientWidth = 640;
			clientHeight = 360;
			private readonly attributes = new Map<string, string>();
			toggleAttribute(name: string, force?: boolean): boolean { const enabled = force ?? !this.attributes.has(name); if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); return enabled; }
			setAttribute(name: string, value = ''): void { this.attributes.set(name, value); }
			getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
			removeAttribute(name: string): void { this.attributes.delete(name); }
			hasAttribute(name: string): boolean { return this.attributes.has(name); }
			getBoundingClientRect(): DOMRect { return { top: 0, left: 0, right: 640, bottom: 360, width: 640, height: 360 } as DOMRect; }
		}
		Object.defineProperty(globalThis, 'HTMLVideoElement', { configurable: true, value: FakeVideo });
		Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeDomElement });
		Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe(): void { } disconnect(): void { } unobserve(): void { } } });
		const root = new FakeDomElement();
		root.isConnected = true;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: () => undefined, removeEventListener: () => undefined } });
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				head: root,
				documentElement: root,
				fullscreenElement: null,
				createElement: () => new FakeDomElement(),
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			},
		});
		Object.defineProperty(globalThis, 'getComputedStyle', {
			configurable: true,
			value: () => ({ objectFit: 'contain', rotate: 'none', scale: 'none', filter: 'none' }),
		});
		Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
		Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => undefined });
		const controller = new VideoEffectsController();
		const operation = controller.apply(new FakeVideo() as unknown as HTMLVideoElement, 'dimEnabled', true);
		controller.dispose();
		await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
