import { afterEach, describe, expect, test } from 'bun:test';
import type { ControlIntent, MediaTarget } from '@nexus/contracts';
import type { MediaRegistry, MediaRegistryEvent } from '../src/content/core/media-registry';
import {
	NativeMediaExecutor,
	seekNativeMedia,
	writeNativePlaybackRate,
} from '../src/content/logic/native-media-executor';
import type { VideoEffectsController } from '../src/content/video/video-effects-controller';
import {
	SPECTRA_PLAYBACK_RATE_EVENT,
	SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE,
	SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE,
} from '../src/shared/playback-rate-bridge';

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
	emitVolumeChange = true;
	volumeWriteHook: ((value: number) => void) | null = null;
	private nativeMuted = false;
	private nativePlaybackRate = 1;
	defaultPlaybackRate = 1;
	get volume(): number { return this.nativeVolume; }
	set volume(value: number) {
		this.nativeVolume = value;
		if (this.emitVolumeChange) {
			queueMicrotask(() => this.dispatchEvent(new Event('volumechange')));
		}
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
		queueMicrotask(() => {
			this.dispatchEvent(new Event('play'));
			this.dispatchEvent(new Event('playing'));
		});
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
	test('keeps the standard default and current playback rates coherent', () => {
		const media = new FakeMediaElement();
		expect(writeNativePlaybackRate(media as unknown as HTMLMediaElement, 1.5)).toBe(1.5);
		expect(media.defaultPlaybackRate).toBe(1.5);
		media.defaultPlaybackRate = 0.75;
		expect(writeNativePlaybackRate(media as unknown as HTMLMediaElement, 2)).toBe(2);
		expect(media.defaultPlaybackRate).toBe(0.75);
	});

	test('routes an XGPlayer speed write through the exact-element MAIN bridge', () => {
		class BridgedMediaElement extends FakeMediaElement {
			private readonly attributes = new Map<string, string>();
			closest(): object { return {}; }
			setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
			getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
			removeAttribute(name: string): void { this.attributes.delete(name); }
		}
		Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
		const media = new BridgedMediaElement();
		let bridgedTarget: EventTarget | null = null;
		media.addEventListener(SPECTRA_PLAYBACK_RATE_EVENT, (event) => {
			bridgedTarget = event.target;
			const request = JSON.parse(
				media.getAttribute(SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE) ?? '{}',
			) as { requestId?: string; speed?: number };
			media.defaultPlaybackRate = request.speed ?? 1;
			media.playbackRate = request.speed ?? 1;
			media.setAttribute(SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE, JSON.stringify({
				requestId: request.requestId,
				actual: media.playbackRate,
			}));
		});

		expect(writeNativePlaybackRate(media as unknown as HTMLMediaElement, 1.75)).toBe(1.75);
		expect(bridgedTarget).toBe(media);
		expect(media.defaultPlaybackRate).toBe(1.75);
		expect(media.getAttribute(SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE)).toBeNull();
		expect(media.getAttribute(SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE)).toBeNull();
	});

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

	test('rejects a getter match when no native event acknowledges the setter', async () => {
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

		const registry = new FakeRegistry();
		registry.element.emitVolumeChange = false;
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:no-native-event',
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
	}, 2_000);

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

	test('reports the seekable-clamped value as desired and actual', async () => {
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
		Object.defineProperty(registry.element, 'seekable', {
			configurable: true,
			value: {
				length: 1,
				start: () => 10,
				end: () => 30,
			} satisfies TimeRanges,
		});
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:clamped-seek',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { currentTime: 5 },
			});
			expect(result.fields.currentTime).toMatchObject({
				desired: 10,
				actual: 10,
				phase: 'applied',
				strategy: 'dom-native',
			});
			expect(registry.element.currentTime).toBe(10);
		} finally {
			executor.dispose();
		}
	});

	test('does not replay a failed native intent onto later media registrations', async () => {
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
		registry.element.volumeWriteHook = (value) => {
			if (Math.abs(value - 0.4) > 0.001) return;
			registry.element.forceVolume(1);
			throw new Error('Volume readback mismatch after site rollback');
		};
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:failed-desired',
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
			expect(result.fields.volumeBase?.phase).toBe('error');

			registry.emit('registered');
			await Promise.resolve();
			expect(sent).toEqual([]);
		} finally {
			executor.dispose();
		}
	});

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

	test('reads and closes the registered PiP owner instead of switching to the active video', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const active = new FakeMediaElement();
		const owner = new FakeMediaElement();
		const activeTarget: MediaTarget = {
			frameId: 0,
			documentId: 'document-pip-owner',
			mediaId: 'media:active',
			sourceRevision: 0,
			kind: 'video',
		};
		const ownerTarget: MediaTarget = {
			...activeTarget,
			mediaId: 'media:pip-owner',
		};
		let pipExitCount = 0;
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: owner as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				pipExitCount += 1;
				documentState.pictureInPictureElement = null;
				queueMicrotask(() => owner.dispatchEvent(new Event('leavepictureinpicture')));
			},
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		const registry = {
			subscribe: () => () => undefined,
			setDocumentId: () => undefined,
			resolve: () => ({ element: active as unknown as HTMLMediaElement, target: activeTarget }),
			resolveVideo: (target: MediaTarget | null) => target?.mediaId === ownerTarget.mediaId
				? { element: owner as unknown as HTMLVideoElement, target: ownerTarget }
				: { element: active as unknown as HTMLVideoElement, target: activeTarget },
			list: () => [
				{ element: active as unknown as HTMLMediaElement, target: activeTarget },
				{ element: owner as unknown as HTMLMediaElement, target: ownerTarget },
			],
		} as unknown as MediaRegistry;
		const effects = {
			dispose: () => undefined,
			snapshot: () => ({
				rotation: 0,
				mirrored: false,
				fill: false,
				filterEnabled: false,
				filter: { brightness: 100, contrast: 100, saturate: 100, grayscale: false, invert: false },
				dimEnabled: false,
				dimOpacity: 0.7,
			}),
		} as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry, effects);
		try {
			expect(executor.read({ fields: ['pip'], target: null })).toEqual({
				target: ownerTarget,
				patch: { pip: true },
			});
			const result = await executor.toggleTrustedActivation('pip');
			expect(result).toEqual({ target: ownerTarget, actual: false });
			expect(pipExitCount).toBe(1);
			expect(documentState.pictureInPictureElement).toBeNull();
		} finally {
			executor.dispose();
		}
	});

	test('exits an unrelated PiP element before entering the selected video', async () => {
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
		const registry = new FakeRegistry();
		registry.target.kind = 'video';
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: other as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				pipExitCount += 1;
				documentState.pictureInPictureElement = null;
			},
		};
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: documentState,
		});
		(registry.element as FakeMediaElement & {
			requestPictureInPicture(): Promise<Record<string, never>>;
		}).requestPictureInPicture = async () => {
			documentState.pictureInPictureElement = registry.element;
			queueMicrotask(() => registry.element.dispatchEvent(new Event('enterpictureinpicture')));
			return {};
		};
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:switch-pip-target',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { pip: true },
			});
			expect(pipExitCount).toBe(1);
			expect(documentState.pictureInPictureElement).toBe(registry.element);
			expect(result.fields.pip).toMatchObject({ phase: 'applied', actual: true });
		} finally {
			executor.dispose();
		}
	});

	test('trusted explicit PiP exits the actual owner before entering or leaving its target', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const video = new FakeMediaElement();
		const unrelatedOwner = new EventTarget();
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document-explicit-pip',
			mediaId: 'media:explicit-pip',
			sourceRevision: 3,
			kind: 'video',
		};
		let pipExitCount = 0;
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: unrelatedOwner as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				const previous = documentState.pictureInPictureElement;
				pipExitCount += 1;
				documentState.pictureInPictureElement = null;
				if (previous instanceof EventTarget) {
					queueMicrotask(() => previous.dispatchEvent(new Event('leavepictureinpicture')));
				}
			},
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		(video as FakeMediaElement & {
			requestPictureInPicture(): Promise<Record<string, never>>;
		}).requestPictureInPicture = async () => {
			documentState.pictureInPictureElement = video;
			queueMicrotask(() => video.dispatchEvent(new Event('enterpictureinpicture')));
			return {};
		};
		const registry = {
			subscribe: () => () => undefined,
			setDocumentId: () => undefined,
			resolve: () => ({ element: video as unknown as HTMLMediaElement, target }),
			resolveVideo: (requested: MediaTarget | null) => requested?.mediaId === target.mediaId
				? { element: video as unknown as HTMLVideoElement, target }
				: null,
			list: () => [{ element: video as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry, effects);
		try {
			const closedOther = await executor.toggleTrustedActivation('pip', target);
			expect(closedOther).toEqual({ target, actual: false });
			expect(documentState.pictureInPictureElement).toBeNull();
			expect(pipExitCount).toBe(1);

			const entered = await executor.toggleTrustedActivation('pip', target);
			expect(entered).toEqual({ target, actual: true });
			expect(documentState.pictureInPictureElement).toBe(video);
			expect(pipExitCount).toBe(1);

			const exited = await executor.toggleTrustedActivation('pip', target);
			expect(exited).toEqual({ target, actual: false });
			expect(documentState.pictureInPictureElement).toBeNull();
			expect(pipExitCount).toBe(2);
		} finally {
			executor.dispose();
		}
	});

	test('explicit Popup PiP exits an unregistered active owner without entering the selected video', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const video = new FakeMediaElement();
		const detachedOwner = new EventTarget();
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document-popup-pip-exit',
			mediaId: 'media:popup-selection',
			sourceRevision: 1,
			kind: 'video',
		};
		let enterCount = 0;
		let exitCount = 0;
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: detachedOwner as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				exitCount += 1;
				documentState.pictureInPictureElement = null;
				queueMicrotask(() => detachedOwner.dispatchEvent(new Event('leavepictureinpicture')));
			},
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		(video as FakeMediaElement & {
			requestPictureInPicture(): Promise<Record<string, never>>;
		}).requestPictureInPicture = async () => {
			enterCount += 1;
			documentState.pictureInPictureElement = video;
			return {};
		};
		const registry = {
			subscribe: () => () => undefined,
			setDocumentId: () => undefined,
			resolve: () => ({ element: video as unknown as HTMLMediaElement, target }),
			resolveVideo: (requested: MediaTarget | null) => requested?.mediaId === target.mediaId
				? { element: video as unknown as HTMLVideoElement, target }
				: null,
			list: () => [{ element: video as unknown as HTMLMediaElement, target }],
		} as unknown as MediaRegistry;
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry, effects);
		try {
			const result = await executor.toggleTrustedActivation('pip', target);
			expect(result).toEqual({ target, actual: false });
			expect(exitCount).toBe(1);
			expect(enterCount).toBe(0);
			expect(documentState.pictureInPictureElement).toBeNull();
		} finally {
			executor.dispose();
		}
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
