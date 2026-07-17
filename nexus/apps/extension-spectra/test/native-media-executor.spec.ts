import { afterEach, describe, expect, test } from 'bun:test';
import type { ControlIntent, MediaTarget } from '@nexus/contracts';
import type { MediaRegistry, MediaRegistryEvent } from '../src/content/core/media-registry';
import {
	NativeMediaExecutor,
	seekNativeMedia,
} from '../src/content/logic/native-media-executor';
import type { VideoEffectsController } from '../src/content/video/video-effects-controller';

type RegistryListener = (
	target: MediaTarget,
	event: MediaRegistryEvent,
	element: HTMLMediaElement,
) => void;

class FakeMediaElement extends EventTarget {
	currentTime = 4;
	duration = 120;
	seeking = false;
	paused = true;
	ended = false;
	private nativeVolume = 1;
	volumeWriteHook: ((value: number) => void) | null = null;
	private nativeMuted = false;
	private nativePlaybackRate = 1;
	get volume(): number { return this.nativeVolume; }
	set volume(value: number) {
		this.nativeVolume = value;
		queueMicrotask(() => this.dispatchEvent(new Event('volumechange')));
		this.volumeWriteHook?.(value);
	}
	forceVolume(value: number): void {
		this.nativeVolume = value;
		this.dispatchEvent(new Event('volumechange'));
	}
	get muted(): boolean { return this.nativeMuted; }
	set muted(value: boolean) {
		this.nativeMuted = value;
		queueMicrotask(() => this.dispatchEvent(new Event('volumechange')));
	}
	get playbackRate(): number { return this.nativePlaybackRate; }
	set playbackRate(value: number) {
		this.nativePlaybackRate = value;
		queueMicrotask(() => this.dispatchEvent(new Event('ratechange')));
	}
	loop = false;
	preservesPitch = true;
	readonly seekable = { length: 0 } as TimeRanges;
	play(): Promise<void> {
		this.paused = false;
		queueMicrotask(() => this.dispatchEvent(new Event('play')));
		return Promise.resolve();
	}
	pause(): void {
		this.paused = true;
		queueMicrotask(() => this.dispatchEvent(new Event('pause')));
	}
}

class FakeRegistry {
	listener: RegistryListener | null = null;
	readonly element = new FakeMediaElement();
	readonly target: MediaTarget = {
		frameId: 0,
		documentId: 'document-seek',
		mediaId: 'media:seek',
		sourceRevision: 0,
		kind: 'audio',
	};

	subscribe(listener: RegistryListener): () => void {
		this.listener = listener;
		return () => { this.listener = null; };
	}

	setDocumentId(): void { }

	resolve(): { element: HTMLMediaElement; target: MediaTarget } {
		return {
			element: this.element as unknown as HTMLMediaElement,
			target: { ...this.target },
		};
	}

	list(): Array<{ element: HTMLMediaElement; target: MediaTarget }> {
		return [this.resolve()];
	}

	emit(event: MediaRegistryEvent): void {
		this.listener?.(
			{ ...this.target },
			event,
			this.element as unknown as HTMLMediaElement,
		);
	}
}

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
const originalVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');

afterEach(() => {
	restore('chrome', originalChrome);
	restore('HTMLMediaElement', originalMedia);
	restore('HTMLVideoElement', originalVideo);
	restore('document', originalDocument);
	restore('requestAnimationFrame', originalRequestAnimationFrame);
	restore('cancelAnimationFrame', originalCancelAnimationFrame);
});

describe('native media single-writer correlation', () => {
	test('waits through microtask, rAF and 50ms page rollbacks before rejecting native ACKs', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true,
			value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
		});

		for (const schedule of [
			(callback: () => void) => queueMicrotask(callback),
			(callback: () => void) => requestAnimationFrame(() => callback()),
			(callback: () => void) => setTimeout(callback, 50),
		]) {
			const registry = new FakeRegistry();
			const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
			const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
			registry.element.volumeWriteHook = (value) => {
				if (Math.abs(value - 0.4) > 0.001) return;
				schedule(() => registry.element.forceVolume(1));
			};
			try {
				const result = await executor.execute({
					intentId: `intent:rollback:${Math.random()}`,
					tabId: 7,
					documentId: registry.target.documentId,
					generation: 1,
					baseRevision: 2,
					source: 'popup',
					requestedCoverage: 'active-target',
					target: registry.target,
					actualContext: {},
					patch: { volumeBase: 40 },
				});
				expect(result.fields.volumeBase).toMatchObject({
					phase: 'error',
					strategy: 'unsupported',
					restoreBaseline: 100,
					lastError: { code: 'readback-mismatch' },
				});
				expect(registry.element.volume).toBe(1);
			} finally {
				executor.dispose();
			}
		}
	}, 5_000);

	test('bounds stable native ACKs when a hidden tab suspends animation frames', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true,
			value: () => 1,
		});
		Object.defineProperty(globalThis, 'cancelAnimationFrame', {
			configurable: true,
			value: () => undefined,
		});

		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const startedAt = performance.now();
			const result = await executor.execute({
				intentId: 'intent:hidden-tab',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { mediaMuted: true },
			});
			expect(result.fields.mediaMuted).toMatchObject({
				phase: 'applied',
				actual: true,
				strategy: 'dom-native',
			});
			expect(performance.now() - startedAt).toBeLessThan(500);
		} finally {
			executor.dispose();
		}
	}, 1_000);
	test('consumes a late owned seek event without publishing a duplicate page revision', async () => {
		const sent: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					sendMessage: async (message: unknown) => { sent.push(message); },
				},
			},
		});
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});

		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(
			registry as unknown as MediaRegistry,
			effects,
		);
		try {
			executor.bindRequestContext(7, registry.target.documentId);
			executor.read({ fields: ['currentTime'], target: registry.target });
			expect(await seekNativeMedia(
				registry.element as unknown as HTMLMediaElement,
				12,
			)).toBe(12);

			registry.emit('seeked');
			await Promise.resolve();
			expect(sent).toEqual([]);
		} finally {
			executor.dispose();
		}
	});

	test('reports user-activation rejection as a terminal native boundary', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});
		const registry = new FakeRegistry();
		registry.element.play = () => Promise.reject(new DOMException(
			'Playback requires transient user activation',
			'NotAllowedError',
		));
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(
			registry as unknown as MediaRegistry,
			effects,
		);
		try {
			const intent: ControlIntent = {
				intentId: 'intent:activation',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { playing: true },
			};
			const result = await executor.execute(intent);
			expect(result.fields.playing).toMatchObject({
				phase: 'error',
				strategy: 'unsupported',
				lastError: {
					code: 'user-activation-required',
					retryable: false,
				},
			});
		} finally {
			executor.dispose();
		}
	});

	test('does not let the losing DOM writer restore a site-native-owned baseline', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: class FakeVideoElement extends FakeMediaElement { },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { pictureInPictureElement: null, fullscreenElement: null },
		});
		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			await executor.execute({
				intentId: 'intent:site-owner',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 1.5 },
			});
			expect(registry.element.playbackRate).toBe(1.5);
			const released = await executor.releasePageSettings({
				operationId: 'operation:restore',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 3,
				source: 'popup',
				target: registry.target,
				operation: 'restore-page-settings',
				payload: { excludedNativeFields: ['speed'] },
			});
			expect(registry.element.playbackRate).toBe(1.5);
			expect(released.releasedFields).not.toContain('speed');
		} finally {
			executor.dispose();
		}
	});

	test('does not exit another element\'s PiP or fullscreen session', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const other = {};
		let pipExitCount = 0;
		let fullscreenExitCount = 0;
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				pictureInPictureEnabled: true,
				pictureInPictureElement: other,
				fullscreenElement: other,
				exitPictureInPicture: async () => { pipExitCount += 1; },
				exitFullscreen: async () => { fullscreenExitCount += 1; },
			},
		});
		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:unrelated-presentation',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { pip: false, fullscreen: false },
			});
			expect(result.fields.pip?.actual).toBe(false);
			expect(result.fields.fullscreen?.actual).toBe(false);
			expect(pipExitCount).toBe(0);
			expect(fullscreenExitCount).toBe(0);
		} finally {
			executor.dispose();
		}
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
