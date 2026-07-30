import { describe, expect, mock, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import { AudioMode, type WebAudioController } from '@nexus/audio-engine';
import type { MediaTarget } from '@nexus/contracts';
import type { PolicyExecutor } from '../src/content/logic/policy-executor';
import type { PolicyExecutorState } from '../src/content/types';
import {
	createMediaObserver,
	hasMediaElements,
} from '../src/content/core/lifecycle/media-observer';
import {
	MediaRegistry,
	setActiveMediaRegistry,
} from '../src/content/core/media-registry';
import { isAnyMediaPlaying } from '../src/content/audio/media-detection';
import {
	abLoopTestApi,
	disposeABLoops,
	observeABLoopSources,
	setPointA,
	setPointB,
} from '../src/content/video/ab-loop';
import {
	addMarker,
	disposeMarkers,
	observeMarkerSources,
	timeMarkerTestApi,
} from '../src/content/video/time-marker';

type MutationCallback = (records: MutationRecord[]) => void;

class FakeElement extends EventTarget {
	readonly descendants: FakeMediaElement[] = [];
	isConnected = true;
	rect = {
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
	};

	querySelectorAll(): FakeMediaElement[] {
		return [...this.descendants];
	}

	getBoundingClientRect(): DOMRect {
		return this.rect as DOMRect;
	}

	contains(node: unknown): boolean {
		return node === this || this.descendants.some((descendant) => descendant.contains(node));
	}
}

class FakeMediaElement extends FakeElement {
	currentTime = 0;
	paused = true;
	ended = false;
	volume: number;
	muted: boolean;
	playbackRate: number;
	src = '';
	currentSrc = '';
	srcObject: object | null = null;
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

	constructor(volume: number, muted = false, playbackRate = 1) {
		super();
		this.volume = volume;
		this.muted = muted;
		this.playbackRate = playbackRate;
	}

	override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (callback) {
			let listeners = this.listeners.get(type);
			if (!listeners) {
				listeners = new Set();
				this.listeners.set(type, listeners);
			}
			listeners.add(callback);
		}
		super.addEventListener(type, callback, options);
	}

	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		if (callback) this.listeners.get(type)?.delete(callback);
		super.removeEventListener(type, callback, options);
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}
}

class FakeVideoElement extends FakeMediaElement { }

class FakeDocument extends EventTarget {
	readonly documentElement = new FakeElement();
	media: FakeMediaElement[] = [];
	fullscreenElement: FakeElement | FakeMediaElement | null = null;

	querySelectorAll(): FakeMediaElement[] {
		return [...this.media];
	}

	querySelector(): FakeMediaElement | null {
		return this.media[0] ?? null;
	}
}

class FakeMutationObserver {
	static latest: FakeMutationObserver | null = null;
	readonly observe = mock(() => undefined);
	readonly disconnect = mock(() => undefined);

	constructor(readonly callback: MutationCallback) {
		FakeMutationObserver.latest = this;
	}

	emit(added: FakeMediaElement[] = [], removed: FakeMediaElement[] = []): void {
		this.callback([{
			addedNodes: added,
			removedNodes: removed,
		} as unknown as MutationRecord]);
	}

	emitAttribute(target: FakeMediaElement, attributeName: string): void {
		this.callback([{
			type: 'attributes',
			target,
			attributeName,
			addedNodes: [],
			removedNodes: [],
		} as unknown as MutationRecord]);
	}
}

class FakeIntersectionObserver {
	readonly observe = mock(() => undefined);
	readonly unobserve = mock(() => undefined);
	readonly disconnect = mock(() => undefined);
}

describe('event-driven media registry', () => {
	test('seeds initial selection from visible geometry before IntersectionObserver delivery', () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		const modal = new FakeVideoElement(1);
		const hiddenPreload = new FakeVideoElement(1);
		feed.paused = false;
		modal.paused = false;
		hiddenPreload.paused = false;
		feed.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		modal.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		hiddenPreload.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		document.documentElement.descendants.push(feed, modal, hiddenPreload);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry((target, event) => events.push({ target, event }));
			registry.setDocumentId('document:initial-visibility');
			const modalTarget = registry.list().find(({ element }) => element === modal)?.target;
			expect(modalTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(modalTarget);
			expect(events.filter(({ event }) => event === 'selected')).toEqual([]);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('keeps reads pure, separates active media/video, and versions every logical source epoch', async () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const audio = new FakeMediaElement(0.8);
		const video = new FakeVideoElement(0.9);
		audio.currentSrc = 'https://media.example/reused.mp3';
		video.currentSrc = 'https://media.example/video.mp4';
		document.documentElement.descendants.push(audio, video);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry((eventTarget, event) => {
				events.push({ target: eventTarget, event });
			});
			registry.setDocumentId('document:registry');
			const audioTarget = requireValue(
				registry.list().find(({ element }) => element === audio)?.target,
				'Expected the registry to assign an identity to the audio fixture',
			);
			const videoTarget = requireValue(
				registry.list().find(({ element }) => element === video)?.target,
				'Expected the registry to assign an identity to the video fixture',
			);
			expect(audioTarget).toBeDefined();
			expect(videoTarget).toBeDefined();

			// Explicit selection is the only selection write. Reads of either identity
			// cannot steal the other target or emit a selected event.
			expect(registry.select(videoTarget)).toBe(true);
			expect(registry.select(audioTarget)).toBe(true);
			const selectedBeforeReads = events.filter(({ event }) => event === 'selected').length;
			expect(registry.peek(videoTarget)?.target).toEqual(videoTarget);
			expect(registry.resolve(null)?.target).toEqual(audioTarget);
			expect(registry.resolveVideo(null)?.target).toEqual(videoTarget);
			expect(events.filter(({ event }) => event === 'selected')).toHaveLength(selectedBeforeReads);

			// A page-owned fullscreen container is attributed to its contained active
			// video even when the independently active media target is audio.
			document.fullscreenElement = document.documentElement;
			document.dispatchEvent(new Event('fullscreenchange'));
			expect(events.filter(({ event }) => event === 'fullscreenchange').at(-1)?.target)
				.toEqual(videoTarget);

			// `emptied + loadstart` is one same-URL load epoch; loadedmetadata closes
			// it so the next explicit load can advance the source revision again.
			audio.dispatchEvent(new Event('emptied'));
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			let currentAudioTarget = registry.list().find(({ element }) => element === audio)?.target;
			expect(currentAudioTarget).toMatchObject({
				mediaId: audioTarget?.mediaId,
				sourceRevision: 1,
			});

			const firstStream = {};
			audio.srcObject = firstStream;
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			const secondStream = {};
			audio.srcObject = secondStream;
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			currentAudioTarget = registry.list().find(({ element }) => element === audio)?.target;
			expect(currentAudioTarget).toMatchObject({
				mediaId: audioTarget.mediaId,
				sourceRevision: 3,
			});
			expect(registry.resolve(audioTarget)).toBeNull();

			// A framework reparent commonly appears as remove+add in one observer
			// batch. Deferring detach to a microtask preserves identity and revision.
			FakeMutationObserver.latest?.emit([audio], [audio]);
			await Promise.resolve();
			expect(registry.list().find(({ element }) => element === audio)?.target)
				.toEqual(currentAudioTarget);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('projects graph ownership without writing native media fields and disposes removed media', async () => {
		const descriptors = captureGlobalDescriptors([
			'chrome',
			'document',
			'window',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
			'setTimeout',
			'clearTimeout',
		]);
		const document = new FakeDocument();
		const window = new EventTarget();
		const first = new FakeMediaElement(0.7);
		const second = new FakeMediaElement(0.9);
		second.currentSrc = 'https://media.example/one.mp4';
		document.documentElement.descendants.push(first);
		const timers = new Map<number, { callback: () => void; delay: number }>();
		let nextTimerId = 0;

		installGlobal('chrome', { runtime: { id: 'spectra-test' } });
		installGlobal('document', document);
		installGlobal('window', window);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);
		installGlobal('setTimeout', (callback: () => void, delay: number) => {
			const timerId = ++nextTimerId;
			timers.set(timerId, { callback, delay });
			return timerId;
		});
		installGlobal('clearTimeout', (timerId: number) => timers.delete(timerId));

		const attachNode = mock((_media: HTMLMediaElement) => true);
		const detachNode = mock((_media: HTMLMediaElement) => undefined);
		const audioController = { attachNode, detachNode } as unknown as WebAudioController;
		const state: PolicyExecutorState = {
			config: {
				enabled: true,
				volume: 60,
				muted: false,
				compressor: false,
				mono: false,
				bass: false,
				eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				pan: 0,
				delay: 0,
				speed: 1.5,
			},
			activeMode: AudioMode.NATIVE_WEBAUDIO,
			desiredMode: AudioMode.NATIVE_WEBAUDIO,
			actualMode: 'webaudio',
			phase: 'active',
			generation: 1,
			hasGesture: true,
			userHasInteracted: true,
			isPopupOpen: false,
		};

		let dispose = () => undefined;
		let disposeActiveRegistry = () => undefined;
		let disposeABSourceObserver = () => undefined;
		let disposeMarkerSourceObserver = () => undefined;
		const releasedABTargets: MediaTarget[] = [];
		const registryEvents: Array<{ target: MediaTarget; event: string }> = [];
		let mediaRegistry: MediaRegistry | null = null;
		try {
			mediaRegistry = new MediaRegistry((target, event) => {
				registryEvents.push({ target, event });
			});
			disposeActiveRegistry = setActiveMediaRegistry(mediaRegistry);
			disposeABSourceObserver = observeABLoopSources(
				mediaRegistry,
				(target) => releasedABTargets.push(target),
			);
			disposeMarkerSourceObserver = observeMarkerSources(mediaRegistry);
			dispose = createMediaObserver(
				state,
				audioController,
				{} as PolicyExecutor,
			);
			expect(hasMediaElements()).toBe(true);
			const playListenersBeforeStatusRead = first.listenerCount('play');
			expect(isAnyMediaPlaying()).toBe(false);
			expect(isAnyMediaPlaying()).toBe(false);
			expect(first.listenerCount('play')).toBe(playListenersBeforeStatusRead);
			expect(first.volume).toBe(0.7);
			expect(first.playbackRate).toBe(1);
			expect(attachNode).toHaveBeenCalledWith(first);

			FakeMutationObserver.latest?.emit([second]);
			expect(second.volume).toBe(0.9);
			expect(second.playbackRate).toBe(1);
			expect(attachNode).toHaveBeenCalledWith(second);
			expect(attachNode).toHaveBeenCalledTimes(2);
			const secondTarget = mediaRegistry.list().find(({ element }) => element === second)?.target;
			expect(secondTarget).toBeDefined();
			mediaRegistry.select(secondTarget ?? null);
			expect(registryEvents.filter(({ event }) => event === 'selected')).toEqual([{
				target: secondTarget,
				event: 'selected',
			}]);
			expect(setPointA()).toBe(0);
			second.currentTime = 1;
			expect(setPointB()).toEqual({ pointB: 1, looping: true });
			expect(addMarker()).not.toBeNull();
			expect(abLoopTestApi.sourceCount()).toBe(1);
			expect(timeMarkerTestApi.sourceCount()).toBe(1);

			second.currentSrc = 'https://media.example/two.mp4';
			FakeMutationObserver.latest?.emitAttribute(second, 'src');
			const replacedTarget = mediaRegistry.list().find(({ element }) => element === second)?.target;
			expect(replacedTarget).toMatchObject({
				mediaId: secondTarget?.mediaId,
				sourceRevision: 1,
			});
			expect(registryEvents.filter(({ event }) => event === 'selected').at(-1)?.target)
				.toMatchObject({ mediaId: secondTarget?.mediaId, sourceRevision: 1 });
			expect(abLoopTestApi.sourceCount()).toBe(0);
			expect(timeMarkerTestApi.sourceCount()).toBe(0);
			expect(releasedABTargets).toEqual([]);
			expect(second.listenerCount('play')).toBe(1);
			expect(detachNode).toHaveBeenCalledWith(second);
			expect(attachNode).toHaveBeenCalledTimes(3);

			second.volume = 0.2;
			second.playbackRate = 1;
			second.dispatchEvent(new Event('loadedmetadata'));
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);
			expect(attachNode).toHaveBeenCalledTimes(4);

			const detachCallsBeforeReparent = detachNode.mock.calls.length;
			FakeMutationObserver.latest?.emit([], [second]);
			await Promise.resolve();
			expect(mediaRegistry.list().some(({ element }) => element === second)).toBe(true);
			expect(detachNode.mock.calls).toHaveLength(detachCallsBeforeReparent);

			second.isConnected = false;
			FakeMutationObserver.latest?.emit([], [second]);
			await Promise.resolve();
			expect(hasMediaElements()).toBe(true);
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);
			expect(detachNode).toHaveBeenCalledWith(second);

			second.isConnected = true;
			FakeMutationObserver.latest?.emit([second]);
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);
			expect(attachNode).toHaveBeenCalledTimes(5);
		} finally {
			dispose();
			disposeABSourceObserver();
			disposeMarkerSourceObserver();
			disposeABLoops();
			disposeMarkers();
			disposeActiveRegistry();
			mediaRegistry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});
});

function installGlobal(key: string, value: unknown): void {
	Object.defineProperty(globalThis, key, { configurable: true, value });
}

function captureGlobalDescriptors(keys: string[]): Map<string, PropertyDescriptor | undefined> {
	return new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
}

function restoreGlobalDescriptors(descriptors: Map<string, PropertyDescriptor | undefined>): void {
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
}
