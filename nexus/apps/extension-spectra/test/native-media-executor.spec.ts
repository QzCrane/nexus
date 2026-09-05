import { afterEach, describe, expect, test } from 'bun:test';
import type { ControlIntent, MediaTarget } from '@nexus/contracts';
import type { MediaRegistry, MediaRegistryEvent } from '../src/content/core/media-registry';
import {
	NativeMediaExecutor,
	writeNativePlaybackRate,
} from '../src/content/logic/native-media-executor';
import { seekNativeMedia } from '../src/content/logic/native-media-async';
import { writePageMediaField } from '../src/content/logic/page-media-bridge';
import type { VideoEffectsController } from '../src/content/video/video-effects-controller';
import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
	type SpectraPageMediaRequest,
	type SpectraPageMediaResult,
} from '../src/shared/page-media-bridge';

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
	readonly element: FakeMediaElement;
	readonly target: MediaTarget = {
		frameId: 0,
		documentId: 'document-seek',
		mediaId: 'media:seek',
		sourceRevision: 0,
		kind: 'audio',
	};

	constructor(element: FakeMediaElement = new FakeMediaElement()) {
		this.element = element;
	}

	get documentId(): string { return this.target.documentId; }

	subscribe(listener: RegistryListener): () => void {
		this.listener = listener;
		return () => { this.listener = null; };
	}

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

class BridgedMediaElement extends FakeMediaElement {
	private readonly attributes = new Map<string, string>();
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	removeAttribute(name: string): void { this.attributes.delete(name); }
}

interface PageMediaState {
	volumeBase: number;
	mediaMuted: boolean;
	speed: number;
	supported?: boolean;
	maximumSpeed?: number;
	delayedMaximumSpeed?: number;
	speedWriteCount?: number;
}

function installPageMediaBridgeStub(
	media: BridgedMediaElement,
	state: PageMediaState,
): void {
	media.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, () => {
		const request = JSON.parse(
			media.getAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE) ?? '{}',
		) as Partial<SpectraPageMediaRequest>;
		if (!request.requestId || !request.field || !request.operation) return;
		if (state.supported === false) {
			const result: SpectraPageMediaResult = {
				requestId: request.requestId,
				field: request.field,
				supported: false,
				actual: null,
			};
			media.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
			return;
		}
		if (request.operation === 'write'
			&& request.field === 'speed'
			&& state.speedWriteCount !== undefined) {
			state.speedWriteCount += 1;
		}
		if (request.operation === 'write'
			&& request.field === 'speed'
			&& typeof request.value === 'number'
			&& state.maximumSpeed !== undefined
			&& request.value > state.maximumSpeed) {
			const before = state.speed;
			state.speed = state.maximumSpeed;
			media.playbackRate = state.maximumSpeed;
			state.speed = before;
			media.playbackRate = before;
			const result: SpectraPageMediaResult = {
				requestId: request.requestId,
				field: request.field,
				supported: true,
				actual: null,
				error: 'Page speed readback mismatch; baseline restored',
			};
			media.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
			return;
		}
		if (request.operation === 'write') {
			if (request.field === 'volumeBase' && typeof request.value === 'number') {
				state.volumeBase = request.value;
				media.volume = request.value / 100 * 0.6131;
			} else if (request.field === 'mediaMuted' && typeof request.value === 'boolean') {
				state.mediaMuted = request.value;
				media.muted = request.value;
			} else if (request.field === 'speed' && typeof request.value === 'number') {
				state.speed = request.value;
				media.playbackRate = request.value;
				const delayedMaximumSpeed = state.delayedMaximumSpeed;
				if (delayedMaximumSpeed !== undefined
					&& request.value > delayedMaximumSpeed) {
					setTimeout(() => {
						state.speed = delayedMaximumSpeed;
						media.playbackRate = delayedMaximumSpeed;
					}, 0);
				}
			}
		}
		const result: SpectraPageMediaResult = {
			requestId: request.requestId,
			field: request.field,
			supported: true,
			actual: state[request.field],
		};
		media.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
	});
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

	test('routes playback speed through the exact-element page-media bridge', () => {
		Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1 };
		installPageMediaBridgeStub(media, state);
		let bridgedTarget: EventTarget | null = null;
		media.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, (event) => { bridgedTarget = event.target; });

		expect(writePageMediaField(media as unknown as HTMLMediaElement, 'speed', 1.75)).toBe(1.75);
		expect(bridgedTarget).toBe(media);
		expect(state.speed).toBe(1.75);
		expect(media.getAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE)).toBeNull();
		expect(media.getAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE)).toBeNull();
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
					sendMessage: async (message: unknown) => {
						if ((message as { type?: string }).type === 'spectra.audio.page-scale.record') {
							return { ok: true, data: { recorded: true } };
						}
						sent.push(message);
					},
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

	test('retains a targetless restore until the first media registration', async () => {
		const sent: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					sendMessage: async (message: unknown) => {
						sent.push(message);
						return {
							ok: false,
							error: { code: 'test-stop', message: 'captured', retryable: false },
						};
					},
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

		const element = new FakeMediaElement();
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document:delayed-preset',
			mediaId: 'media:delayed-preset',
			sourceRevision: 0,
			kind: 'audio',
		};
		let available = false;
		let listener: RegistryListener | null = null;
		const registry = {
			subscribe: (next: RegistryListener) => {
				listener = next;
				return () => { listener = null; };
			},
			documentId: target.documentId,
			resolve: () => available
				? { element: element as unknown as HTMLMediaElement, target }
				: null,
			list: () => [],
		} as unknown as MediaRegistry;
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry, effects);
		try {
			const initial = await executor.execute({
				intentId: 'intent:delayed-preset',
				tabId: 7,
				documentId: target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'restore',
				requestedCoverage: 'active-target',
				target: null,
				actualContext: {},
				patch: { volumeBase: 40, speed: 1.5 },
			});
			expect(initial.fields.volumeBase?.phase).toBe('error');
			expect(initial.fields.speed?.phase).toBe('error');

			available = true;
			listener?.({ ...target }, 'registered', element as unknown as HTMLMediaElement);
			await Promise.resolve();
			expect(sent).toContainEqual(expect.objectContaining({
				type: 'spectra.control.intent.submit',
				payload: expect.objectContaining({
					source: 'restore',
					target,
					patch: { volumeBase: 40, speed: 1.5 },
				}),
			}));
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
					sendMessage: async (message: unknown) => {
						if ((message as { type?: string }).type === 'spectra.audio.page-scale.record') {
							return { ok: true, data: { recorded: true } };
						}
						sent.push(message);
					},
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
			documentId: activeTarget.documentId,
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
				observedStrategies: { pip: 'dom-native' },
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
			documentId: target.documentId,
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
			documentId: target.documentId,
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

	test('reads page-semantic volume, mute, and speed instead of a non-linear media element projection', () => {
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
		const media = new BridgedMediaElement();
		media.forceVolume(0.6131);
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1.25 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = executor.read({
				target: registry.target,
				fields: ['volumeBase', 'mediaMuted', 'speed'],
			});
			expect(result.patch).toMatchObject({ volumeBase: 100, mediaMuted: false, speed: 1.25 });
		} finally {
			executor.dispose();
		}
	});

	test('falls back to the standard volume getter when no page-semantic controller exists', () => {
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
		registry.element.forceVolume(0.6131);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			expect(executor.read({
				target: registry.target,
				fields: ['volumeBase'],
			}).patch.volumeBase).toBe(61.31);
		} finally {
			executor.dispose();
		}
	});

	test('reports page-semantic volume changes back to the coordinator', async () => {
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
		const messages: Array<{ type?: string; payload?: {
			patch?: Record<string, unknown>;
			observedStrategies?: Record<string, unknown>;
		} }> = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage: async (message: typeof messages[number]) => {
				messages.push(message);
				return undefined;
			} } },
		});
		const media = new BridgedMediaElement();
		media.forceVolume(0.6131);
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			executor.bindRequestContext(7, registry.target.documentId);
			state.volumeBase = 50;
			media.forceVolume(0.30655);
			registry.emit('volumechange');
			await Promise.resolve();
			const observation = messages.find((message) => message.type === 'spectra.control.intent.submit');
			expect(observation?.payload?.patch).toMatchObject({ volumeBase: 50, mediaMuted: false });
			expect(observation?.payload?.observedStrategies).toEqual({
				volumeBase: 'page-native',
				mediaMuted: 'page-native',
			});
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test('uses the page-semantic writer for popup and mute-hotkey controls', async () => {
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
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const popup = await executor.execute({
				intentId: 'intent:page-media:popup',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { volumeBase: 140, speed: 1.5 },
			});
			const hotkey = await executor.execute({
				intentId: 'intent:page-media:hotkey',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 3,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { mediaMuted: true },
			});

			expect(popup.fields.volumeBase).toMatchObject({ phase: 'applied', strategy: 'page-native', actual: 140 });
			expect(popup.fields.speed).toMatchObject({ phase: 'applied', strategy: 'page-native', actual: 1.5 });
			expect(hotkey.fields.mediaMuted).toMatchObject({ phase: 'applied', strategy: 'page-native', actual: true });
			expect(state).toEqual({ volumeBase: 140, mediaMuted: true, speed: 1.5 });

			const released = await executor.releasePageSettings({
				operationId: 'operation:page-media:restore',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 4,
				source: 'popup',
				target: registry.target,
				operation: 'restore-page-settings',
				payload: {},
			});
			expect(released.releasedFields).toEqual(expect.arrayContaining([
				'volumeBase', 'mediaMuted', 'speed',
			]));
			expect(released.fields.volumeBase).toMatchObject({
				actual: 100,
				strategy: 'page-native',
				controlled: false,
			});
			expect(state).toEqual({ volumeBase: 100, mediaMuted: false, speed: 1 });
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test('upgrades a DOM-owned restore when a page controller appears later in the same document', async () => {
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
		const media = new BridgedMediaElement();
		const state: PageMediaState = {
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			supported: false,
			speedWriteCount: 0,
		};
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		media.addEventListener('ratechange', () => registry.emit('ratechange'));
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const restored = await executor.execute({
				intentId: 'intent:page-media:late-controller-restore',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'restore',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 2 },
			});
			expect(restored.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'dom-native',
				actual: 2,
			});
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(2);

			state.supported = true;
			const adjusted = await executor.execute({
				intentId: 'intent:page-media:late-controller-adjust',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 3,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 2.5 },
			});
			expect(adjusted.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'page-native',
				actual: 2.5,
			});
			expect(state.speedWriteCount).toBe(1);
			expect(state.speed).toBe(2.5);
			expect(media.playbackRate).toBe(2.5);

			const released = await executor.releasePageSettings({
				operationId: 'operation:page-media:late-controller-release',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 4,
				source: 'popup',
				target: registry.target,
				operation: 'restore-page-settings',
				payload: {},
			});
			expect(released.fields.speed).toMatchObject({
				actual: 1,
				strategy: 'page-native',
				controlled: false,
			});
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(1);
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test('keeps DOM ownership after a late page controller rejects one value and upgrades on a later accepted value', async () => {
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
		const media = new BridgedMediaElement();
		const state: PageMediaState = {
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			supported: false,
			maximumSpeed: 2,
			speedWriteCount: 0,
		};
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		media.addEventListener('ratechange', () => registry.emit('ratechange'));
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			await executor.execute({
				intentId: 'intent:page-media:late-capped-restore',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 5,
				source: 'restore',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 1.5 },
			});
			state.supported = true;

			const rejectedUpgrade = await executor.execute({
				intentId: 'intent:page-media:late-capped-fallback',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 6,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 2.5 },
			});
			expect(rejectedUpgrade.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'dom-native',
				actual: 2.5,
			});
			expect(state.speedWriteCount).toBe(1);
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(2.5);

			const acceptedUpgrade = await executor.execute({
				intentId: 'intent:page-media:late-capped-upgrade',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 7,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 1.75 },
			});
			expect(acceptedUpgrade.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'page-native',
				actual: 1.75,
			});
			expect(state.speedWriteCount).toBe(2);
			expect(state.speed).toBe(1.75);
			expect(media.playbackRate).toBe(1.75);
		} finally {
			executor.dispose();
		}
	}, 3_000);

	test('falls through to standard playbackRate when an unowned page controller rejects a higher speed', async () => {
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
		const observations: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					sendMessage: async (message: unknown) => {
						// Page-entry solidification reports are not element observations.
						if ((message as { type?: string }).type === 'spectra.audio.page-scale.record') {
							return { ok: true, data: { recorded: true } };
						}
						observations.push(message);
						return undefined;
					},
				},
			},
		});
		const media = new BridgedMediaElement();
		const state: PageMediaState = {
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			maximumSpeed: 2,
		};
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		media.addEventListener('ratechange', () => registry.emit('ratechange'));
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const acknowledgement = await executor.execute({
				intentId: 'intent:page-media:capped-speed',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 13,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 4 },
			});

			expect(acknowledgement.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'dom-native',
				actual: 4,
			});
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(4);
			expect(executor.read({
				target: registry.target,
				fields: ['speed'],
			})).toMatchObject({
				patch: { speed: 4 },
				observedStrategies: { speed: 'dom-native' },
			});
			expect(observations).toEqual([]);
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test('restores a high speed through DOM fallback when a page controller clamps asynchronously', async () => {
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
		const observations: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					sendMessage: async (message: unknown) => {
						// Page-entry solidification reports are not element observations.
						if ((message as { type?: string }).type === 'spectra.audio.page-scale.record') {
							return { ok: true, data: { recorded: true } };
						}
						observations.push(message);
						return undefined;
					},
				},
			},
		});
		const media = new BridgedMediaElement();
		const state: PageMediaState = {
			volumeBase: 100,
			mediaMuted: false,
			speed: 1,
			delayedMaximumSpeed: 3,
		};
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		media.addEventListener('ratechange', () => registry.emit('ratechange'));
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const acknowledgement = await executor.execute({
				intentId: 'intent:page-media:delayed-cap-restore',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 21,
				source: 'restore',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 4 },
			});

			expect(acknowledgement.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'dom-native',
				actual: 4,
			});
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(4);
			expect(observations).toEqual([]);
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test('never switches an owned page field to the DOM writer when its controller disappears', async () => {
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
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const first = await executor.execute({
				intentId: 'intent:page-media:owned',
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
			expect(first.fields.volumeBase).toMatchObject({
				phase: 'applied',
				strategy: 'page-native',
			});
			expect(media.volume).toBeCloseTo(0.24524, 5);

			state.supported = false;
			expect(executor.read({
				target: registry.target,
				fields: ['volumeBase'],
			})).toMatchObject({
				patch: { volumeBase: 24.52 },
				observedStrategies: { volumeBase: 'dom-native' },
			});
			const second = await executor.execute({
				intentId: 'intent:page-media:controller-gone',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 3,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { volumeBase: 30 },
			});
			expect(second.fields.volumeBase).toMatchObject({ phase: 'error', controlled: false });
			expect(media.volume).toBeCloseTo(0.24524, 5);
		} finally {
			executor.dispose();
		}
	}, 2_000);
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
