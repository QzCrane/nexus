import { describe, expect, mock, test } from 'bun:test';
import type { AudioConfig } from '@nexus/contracts';
import { AudioMode, type WebAudioController } from '@nexus/audio-engine';
import type { PolicyExecutor } from '../src/content/logic/policy-executor';
import type { PolicyExecutorState } from '../src/content/types';
import { enableVolumeLock, releaseVolumeLock } from '../src/content/audio/dom-volume';
import {
	createMediaObserver,
	hasMediaElements,
	MEDIA_REGISTRY_REFRESH_EVENT,
} from '../src/content/core/lifecycle/media-observer';

type MutationCallback = (records: MutationRecord[]) => void;

class FakeElement extends EventTarget {
	readonly descendants: FakeMediaElement[] = [];

	querySelectorAll(): FakeMediaElement[] {
		return [...this.descendants];
	}
}

class FakeMediaElement extends FakeElement {
	volume: number;
	muted: boolean;
	playbackRate: number;
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

class FakeDocument extends EventTarget {
	readonly documentElement = new FakeElement();
	media: FakeMediaElement[] = [];

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
}

describe('event-driven media registry', () => {
	test('applies current config per element and fully disposes removed media before reinsertion', () => {
		const descriptors = captureGlobalDescriptors([
			'chrome',
			'document',
			'window',
			'Node',
			'Element',
			'HTMLMediaElement',
			'MutationObserver',
			'setTimeout',
			'clearTimeout',
			'requestAnimationFrame',
			'cancelAnimationFrame',
		]);
		const document = new FakeDocument();
		const window = new EventTarget();
		const first = new FakeMediaElement(0.7);
		const second = new FakeMediaElement(0.9);
		document.media = [first];
		const timers = new Map<number, { callback: () => void; delay: number }>();
		const frames = new Map<number, FrameRequestCallback>();
		const cancelledFrames: number[] = [];
		let nextTimerId = 0;
		let nextFrameId = 0;

		installGlobal('chrome', { runtime: { id: 'spectra-test' } });
		installGlobal('document', document);
		installGlobal('window', window);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('setTimeout', (callback: () => void, delay: number) => {
			const timerId = ++nextTimerId;
			timers.set(timerId, { callback, delay });
			return timerId;
		});
		installGlobal('clearTimeout', (timerId: number) => timers.delete(timerId));
		installGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			const frameId = ++nextFrameId;
			frames.set(frameId, callback);
			return frameId;
		});
		installGlobal('cancelAnimationFrame', (frameId: number) => {
			cancelledFrames.push(frameId);
			frames.delete(frameId);
		});

		const attachNode = mock((_media: HTMLMediaElement) => true);
		const updateElementParams = mock((_media: HTMLMediaElement, _config: AudioConfig) => true);
		const detachNode = mock((_media: HTMLMediaElement) => undefined);
		const audioController = { attachNode, updateElementParams, detachNode } as unknown as WebAudioController;
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
		try {
			enableVolumeLock(0.6, false);
			dispose = createMediaObserver(
				state,
				audioController,
				{} as PolicyExecutor,
			);
			expect(hasMediaElements()).toBe(true);
			expect(first.volume).toBe(0.6);
			expect(first.playbackRate).toBe(1.5);
			expect(first.listenerCount('play')).toBe(1);
			expect(first.listenerCount('pause')).toBe(1);
			expect(first.listenerCount('loadedmetadata')).toBe(1);
			expect(first.listenerCount('volumechange')).toBe(1);
			expect(attachNode).toHaveBeenCalledWith(first);
			expect(updateElementParams).toHaveBeenCalledWith(first, expect.objectContaining({ volume: 100 }));

			document.media.push(second);
			FakeMutationObserver.latest?.emit([second]);
			expect(second.volume).toBe(0.6);
			expect(second.playbackRate).toBe(1.5);
			expect(second.listenerCount('play')).toBe(1);
			expect(second.listenerCount('volumechange')).toBe(1);
			expect(attachNode).toHaveBeenCalledWith(second);
			expect(attachNode).toHaveBeenCalledTimes(2);
			expect(updateElementParams).toHaveBeenCalledWith(second, expect.objectContaining({ volume: 100 }));

			second.volume = 0.2;
			second.playbackRate = 1;
			second.dispatchEvent(new Event('loadedmetadata'));
			expect(second.volume).toBe(0.6);
			expect(second.playbackRate).toBe(1.5);

			fireTimersByDelay(timers, 100);
			second.volume = 0.4;
			second.dispatchEvent(new Event('volumechange'));
			expect(frames).toHaveLength(1);
			const pendingFrame = [...frames.keys()][0];
			if (pendingFrame === undefined) throw new Error('Expected a pending volume frame');

			document.media = [first];
			FakeMutationObserver.latest?.emit([], [second]);
			expect(hasMediaElements()).toBe(true);
			expect(second.listenerCount('play')).toBe(0);
			expect(second.listenerCount('pause')).toBe(0);
			expect(second.listenerCount('loadedmetadata')).toBe(0);
			expect(second.listenerCount('volumechange')).toBe(0);
			expect(cancelledFrames).toContain(pendingFrame);
			expect(frames).toHaveLength(0);
			expect(second.volume).toBe(0.9);
			expect(second.playbackRate).toBe(1);
			expect(detachNode).toHaveBeenCalledWith(second);

			document.media = [first, second];
			document.dispatchEvent(new Event(MEDIA_REGISTRY_REFRESH_EVENT));
			expect(second.listenerCount('play')).toBe(1);
			expect(second.listenerCount('volumechange')).toBe(1);
			expect(second.volume).toBe(0.6);
			expect(second.playbackRate).toBe(1.5);
			expect(attachNode).toHaveBeenCalledTimes(3);
		} finally {
			dispose();
			releaseVolumeLock();
			expect(FakeMutationObserver.latest?.disconnect).toHaveBeenCalledTimes(1);
			expect(first.listenerCount('play')).toBe(0);
			expect(second.listenerCount('play')).toBe(0);
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});
});

function fireTimersByDelay(
	timers: Map<number, { callback: () => void; delay: number }>,
	delay: number,
): void {
	for (const [timerId, timer] of [...timers]) {
		if (timer.delay !== delay) continue;
		timers.delete(timerId);
		timer.callback();
	}
}

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
