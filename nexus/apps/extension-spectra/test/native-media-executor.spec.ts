import { afterEach, describe, expect, test } from 'bun:test';
import { isControlApplyAck } from '@nexus/contracts';
import type { ControlIntent, MediaTarget } from '@nexus/contracts';
import type { MediaRegistry, MediaRegistryEvent } from '../src/content/core/media-registry';
import {
	NativeMediaExecutor,
	writeNativePlaybackRate,
	writeNativeMediaMuted,
} from '../src/content/logic/native-media-executor';
import { seekNativeMedia } from '../src/content/logic/native-media-async';
import {
	configureNativeWritePolicy,
	resetNativeWritePolicy,
	resolveNativeWriteMode,
	resolveNativeWriteSiteKey,
} from '../src/content/logic/native-write-policy';
import {
	resetNativeWriteTelemetry,
	snapshotNativeWriteTelemetry,
} from '../src/content/logic/native-write-telemetry';
import { writePageMediaField } from '../src/content/logic/page-media-bridge';
import { noteMediaUserGesture } from '../src/shared/content-runtime';
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
	removalReason?: 'detached' | 'source-change',
) => void;

class FakeMediaElement extends EventTarget {
	currentTime = 4;
	duration = 120;
	seeking = false;
	// A real element that reports metadata reports ranges with it, and
	// `isLiveMedia` reads them as the evidence that separates a broadcast from a
	// resource that simply delivered nothing.
	buffered = { length: 1 } as TimeRanges;
	paused = true;
	ended = false;
	private nativeVolume = 1;
	emitVolumeChange = true;
	volumeWriteHook: ((value: number) => void) | null = null;
	private nativeMuted = false;
	mutedWriteHook: ((value: boolean) => void) | null = null;
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
		this.mutedWriteHook?.(value);
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
	selectionRevision = 0;
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

	emit(event: MediaRegistryEvent, removalReason?: 'detached' | 'source-change'): void {
		if (event === 'selected') this.selectionRevision += 1;
		this.listener?.(
			{ ...this.target },
			event,
			this.element as unknown as HTMLMediaElement,
			removalReason,
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
	acceptedButClampedSpeed?: number;
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
				media.playbackRate = request.value === 1.3 && state.acceptedButClampedSpeed !== undefined
					? state.acceptedButClampedSpeed : request.value;
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
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
	restore('chrome', originalChrome);
	restore('HTMLMediaElement', originalMedia);
	restore('HTMLVideoElement', originalVideo);
	restore('document', originalDocument);
	restore('requestAnimationFrame', originalRequestAnimationFrame);
	restore('cancelAnimationFrame', originalCancelAnimationFrame);
	restore('navigator', originalNavigator);
});

describe('native media single-writer correlation', () => {
	test.each(['timer', 'loadeddata', 'durationchange', 'page', 'release', 'unrelated-field', 'unrelated-inflight', 'terminal', 'dispose', 'bounded'] as const)(
		'automatically resumes an unfinished source restore without a popup (%s)', async (wake) => {
			installFakeMediaGlobals();
			const registry = new FakeRegistry();
			const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
			let restores = 0;
			let finishFirst!: () => void;
			const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
			Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
				id: 'spectra-test', sendMessage: async (message: { type: string; payload: Partial<ControlIntent> }) => {
					if (message.type !== 'spectra.control.intent.submit' || message.payload.source !== 'restore') return { ok: true, data: { recorded: true } };
					restores += 1;
					if (restores === 1 && wake === 'unrelated-inflight') await firstPending;
					if (wake === 'terminal') return { ok: false, error: { code: 'permission-denied', message: 'Permission denied', retryable: false } };
					if (restores === 1 || wake === 'bounded') return { ok: false, error: { code: 'stale-media-source', message: 'Source changed before commit', retryable: true } };
					return { ok: true, data: await executor.execute({ intentId: 'automatic:retry', tabId: 7,
						documentId: registry.documentId, generation: 1, baseRevision: 0, actualContext: {}, ...message.payload } as ControlIntent) };
				},
			} } });
			try {
				await executor.execute({ intentId: 'automatic:seed', tabId: 7, documentId: registry.documentId,
					generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
					target: registry.target, actualContext: {}, patch: { volumeBase: 40 } });
				registry.emit('removed');
				registry.target.sourceRevision += 1;
				registry.element.forceVolume(1);
				registry.emit('registered');
				registry.emit('selected');
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(restores).toBe(1);
				if (wake === 'loadeddata' || wake === 'durationchange') registry.emit(wake);
				if (wake === 'terminal') { registry.emit('loadeddata'); registry.emit('play'); }
				if (wake === 'dispose') executor.dispose();
				if (wake === 'page') { registry.element.forceVolume(0.7); registry.emit('volumechange'); }
				if (wake === 'unrelated-field' || wake === 'unrelated-inflight') await executor.execute({ intentId: 'automatic:other-field', tabId: 7,
					documentId: registry.documentId, generation: 1, baseRevision: 0, source: 'popup',
					requestedCoverage: 'active-target', target: registry.target, actualContext: {}, patch: { speed: 2 } });
				finishFirst();
				if (wake === 'release') await executor.releasePageSettings({ operationId: 'automatic:release', tabId: 7,
					documentId: registry.documentId, generation: 1, baseRevision: 0, source: 'popup',
					target: registry.target, operation: 'restore-page-settings', payload: {} });
				await new Promise((resolve) => setTimeout(resolve, wake === 'loadeddata' || wake === 'durationchange' ? 30 : wake === 'bounded' ? 1700 : 400));
				const stopped = wake === 'release' || wake === 'terminal' || wake === 'dispose' || wake === 'bounded';
				expect(registry.element.volume).toBe(wake === 'page' ? 0.7 : stopped ? 1 : 0.4);
				expect(restores).toBe(wake === 'bounded' ? 4 : wake === 'page' || stopped ? 1 : 2);
			} finally { finishFirst(); executor.dispose(); }
		},
	);
	test('a first document restore follows a source replaced during the native write without a prior gesture', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		let automatic: Promise<unknown> | undefined;
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: { type: string; payload: Partial<ControlIntent> }) => {
				if (message.type !== 'spectra.control.intent.submit' || message.payload.source !== 'restore') return { ok: true, data: { recorded: true } };
				automatic = executor.execute({ intentId: 'initial:automatic', tabId: 7, documentId: registry.documentId,
					generation: 1, baseRevision: 0, actualContext: {}, ...message.payload } as ControlIntent);
				return { ok: true, data: await automatic };
			},
		} } });
		registry.element.volumeWriteHook = () => {
			registry.element.volumeWriteHook = undefined;
			registry.emit('removed'); registry.target.sourceRevision += 1;
			registry.element.forceVolume(1); registry.emit('registered'); registry.emit('selected');
		};
		try {
			await expect(executor.execute({ intentId: 'initial:configured', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'restore', requestedCoverage: 'active-target',
				target: null, actualContext: {}, patch: { volumeBase: 40 } })).rejects.toMatchObject({ code: 'stale-media-source' });
			expect(automatic).toBeDefined();
			await automatic;
			expect(executor.mediaIntentState()).toBe('retained');
			expect(registry.element.volume).toBe(0.4);
		} finally { executor.dispose(); }
	});

	test('a queued automatic restore cannot overwrite a subsequent page volume gesture', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		let queued: Partial<ControlIntent> | undefined;
		let finish!: () => void;
		const held = new Promise<void>((resolve) => { finish = resolve; });
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: { type: string; payload: Partial<ControlIntent> }) => {
				if (message.type !== 'spectra.control.intent.submit' || message.payload.source !== 'restore') return { ok: true, data: { recorded: true } };
				queued = message.payload;
				await held;
				return { ok: false, error: { code: 'policy-denied', message: 'Page took ownership', retryable: false } };
			},
		} } });
		try {
			await executor.execute({ intentId: 'queued:seed', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { volumeBase: 40 } });
			registry.emit('removed'); registry.target.sourceRevision += 1;
			registry.element.forceVolume(1); registry.emit('registered'); registry.emit('selected');
			expect(queued).toBeDefined();
			registry.element.forceVolume(0.7); registry.emit('volumechange');
			const ack = await executor.execute({ intentId: 'queued:late', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, actualContext: {}, ...queued } as ControlIntent);
			expect(ack.fields.volumeBase?.lastError?.code).toBe('policy-denied');
			expect(registry.element.volume).toBe(0.7);
		} finally { finish(); executor.dispose(); }
	});
	test('accepts an automatic restore after the same element starts a new selection visit', async () => {
		installFakeMediaGlobals();
		// Earlier cases leave drift evidence for this site, which would force a
		// verified write; the visit fence is the subject here, not the write mode.
		resetNativeWritePolicy();
		const registry = new FakeRegistry();
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		let queued: Partial<ControlIntent> | undefined;
		let result: Awaited<ReturnType<NativeMediaExecutor['execute']>> | undefined;
		let failure: unknown;
		let finish!: () => void;
		const held = new Promise<void>((resolve) => { finish = resolve; });
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: { type: string; payload: Partial<ControlIntent> }) => {
				if (message.type !== 'spectra.control.intent.submit' || message.payload.source !== 'restore') return { ok: true, data: { recorded: true } };
				queued = message.payload;
				await held;
				try {
					result = await executor.execute({ intentId: 'visit:late', tabId: 7, documentId: registry.documentId,
						generation: 1, baseRevision: 0, actualContext: {}, ...queued } as ControlIntent);
				} catch (error) { failure = error; throw error; }
				return { ok: true, data: result };
			},
		} } });
		try {
			await executor.execute({ intentId: 'visit:seed', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { volumeBase: 40 } });
			registry.element.forceVolume(1);
			registry.emit('selected');
			expect(queued?.mediaRestore).toBeDefined();
			// The page re-announces the same element: the visit advances, but the
			// selected element, source and desired revision the queued restore names
			// are still current. Rejecting it left the page volume unrecovered.
			registry.selectionRevision += 1;
			finish();
			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(failure).toBeUndefined();
			expect(result?.fields.volumeBase).toMatchObject({ actual: 40, lastError: null });
			expect(registry.element.volume).toBeCloseTo(0.4, 5);
		} finally { finish(); executor.dispose(); resetNativeWritePolicy(); }
	});

	test.each([false, true])('re-publishes settled route playback before effects even without a template (%s)', async (withTemplate) => {
		installFakeMediaGlobals(); const registry = new FakeRegistry(); registry.element.paused = false;
		let revision = 0;
		Object.assign(registry, { captureObservation: () => ({ owner: 'route-owner', epoch: 1,
			selection: registry.selectionRevision, revision: ++revision }) });
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			if (withTemplate) await executor.execute({ intentId: 'route:seed', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target: registry.target,
				actualContext: {}, patch: { speed: 2 } });
			if (withTemplate) { registry.emit('selected'); await new Promise((resolve) => setTimeout(resolve, 0)); }
			// The first selected/play messages were lost at a history fence. The
			// already-playing source has no second play event to repair the view.
			messages.length = 0; executor.reconcileRoute('https://fixture.example/live');
			expect(messages[0]?.type).toBe('spectra.content.target.changed');
			expect(messages[1]).toMatchObject({ type: 'spectra.control.intent.submit', payload: { source: 'page',
				target: registry.target, patch: { playing: true }, mediaObservation: { owner: 'route-owner', epoch: 1 } } });
			if (withTemplate) expect(messages[2]).toMatchObject({ type: 'spectra.control.intent.submit', payload: { source: 'restore' } });
			const stamp = messages[1]?.payload.mediaObservation as { revision: number };
			executor.reconcileRoute('https://fixture.example/live');
			const latestStamp = messages.at(-1)?.payload.mediaObservation as { revision: number } | undefined;
			expect(latestStamp?.revision).toBeGreaterThan(stamp.revision);
			expect(registry.element.paused).toBe(false);
		} finally { executor.dispose(); }
	});

	test('publishes an established selection when a runtime attaches after it was selected', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		Object.assign(registry, { captureObservation: () => ({ owner: 'attach-owner', epoch: 1,
			selection: registry.selectionRevision, revision: 1 }) });
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			executor.publishCurrentSelection();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const changed = messages.find((message) => message.type === 'spectra.content.target.changed');
			expect(changed?.payload.target).toMatchObject({ mediaId: registry.target.mediaId });
			expect(changed?.payload.mediaObservation).toMatchObject({ owner: 'attach-owner' });
			// The badge must not wait for the first native change or a Popup read:
			// the values that already exist are part of the attach publication.
			const observation = messages.find((message) => message.type === 'spectra.control.intent.submit');
			expect(observation?.payload).toMatchObject({
				source: 'page',
				target: registry.target,
				patch: { volumeBase: 100, mediaMuted: false, speed: 1, playing: false },
			});
		} finally { executor.dispose(); }
	});

	test('completes the attach publication when the first selection arrives after it', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		let available = false;
		const resolve = registry.resolve.bind(registry);
		registry.resolve = (requested?: MediaTarget | null) => available ? resolve(requested) : null;
		registry.list = () => available ? [resolve()] : [];
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			// A restore can attach the runtime before the player exists. The attach
			// itself has nothing to announce.
			executor.publishCurrentSelection();
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			expect(messages).toHaveLength(0);

			// The first selection completes that publication with the values that
			// already exist; later selections keep the target-only path.
			available = true;
			registry.emit('selected');
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			const observations = messages.filter((message) => message.type === 'spectra.control.intent.submit');
			expect(observations).toHaveLength(1);
			expect(observations[0]?.payload).toMatchObject({
				source: 'page',
				target: registry.target,
				patch: { volumeBase: 100, mediaMuted: false, speed: 1, playing: false },
			});

			registry.emit('selected');
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			expect(messages.filter((message) => message.type === 'spectra.control.intent.submit')).toHaveLength(1);
		} finally { executor.dispose(); }
	});

	test('publishes the replacement player values when a route switch selects another element', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			executor.publishCurrentSelection();
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			messages.length = 0;
			// `/follow` -> `/follow/live/<id>` is an SPA switch: same document, a
			// different player element. The badge must adopt that player's own
			// values instead of waiting for a native change or a Popup read.
			const live = new FakeMediaElement();
			live.volume = 0.42;
			const liveTarget = { ...registry.target, mediaId: 'media:live' };
			registry.resolve = () => ({ element: live as unknown as HTMLMediaElement, target: liveTarget });
			registry.list = () => [registry.resolve()];
			registry.listener?.({ ...liveTarget }, 'selected', live as unknown as HTMLMediaElement);
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			const observation = messages.find((message) => message.type === 'spectra.control.intent.submit');
			expect(observation?.payload).toMatchObject({
				source: 'page',
				target: liveTarget,
				patch: { volumeBase: 42, mediaMuted: false, speed: 1, playing: false },
			});
		} finally { executor.dispose(); }
	});

	test('observes a native volume change from any registered player the selection has not reached', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		const live = new FakeMediaElement();
		live.volume = 0.42;
		const liveTarget: MediaTarget = { ...registry.target, mediaId: 'media:live', kind: 'video' };
		registry.resolve = ((requested?: MediaTarget | null) => requested?.mediaId === 'media:live'
			? { element: live as unknown as HTMLMediaElement, target: liveTarget }
			: { element: registry.element as unknown as HTMLMediaElement, target: { ...registry.target } });
		try {
			registry.listener?.({ ...liveTarget }, 'volumechange', live as unknown as HTMLMediaElement);
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			const observation = messages.find((message) => message.type === 'spectra.control.intent.submit');
			expect(observation?.payload).toMatchObject({
				source: 'page',
				target: liveTarget,
				patch: { volumeBase: 42, mediaMuted: false },
			});
			expect(messages.some((message) => message.type === 'spectra.content.target.changed')).toBe(false);
		} finally { executor.dispose(); }
	});

	test('never promotes a semantically hidden preview from its own volume event', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		const preview = new FakeMediaElement();
		(preview as unknown as { hidden: boolean }).hidden = true;
		preview.volume = 0.13;
		const previewTarget: MediaTarget = { ...registry.target, mediaId: 'media:preview', kind: 'video' };
		registry.resolve = ((requested?: MediaTarget | null) => requested?.mediaId === 'media:preview'
			? { element: preview as unknown as HTMLMediaElement, target: previewTarget }
			: { element: registry.element as unknown as HTMLMediaElement, target: { ...registry.target } });
		try {
			registry.listener?.({ ...previewTarget }, 'volumechange', preview as unknown as HTMLMediaElement);
			await new Promise((resolveTick) => setTimeout(resolveTick, 0));
			expect(messages.some((message) => message.type === 'spectra.control.intent.submit')).toBe(false);
		} finally { executor.dispose(); }
	});

	test('moves an active-target write to the new selection when another source becomes selected mid-write', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		const original = registry.resolve(); const next = { element: new FakeMediaElement() as unknown as HTMLMediaElement,
			target: { ...original.target, mediaId: 'media:new-current' } };
		let selected = original;
		registry.resolve = (requested?: MediaTarget | null) => requested?.mediaId === original.target.mediaId ? original : selected;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			const writing = executor.execute({ intentId: 'speed:old-visit', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target: original.target,
				actualContext: {}, patch: { speed: 2 } });
			expect(original.element.playbackRate).toBe(2);
			selected = next; registry.selectionRevision += 1;
			expect(executor.read({ target: null, fields: ['playing'] }).target).toEqual(next.target);
			// The gesture belongs to the tab, and the tab now plays the other source.
			// Re-applying once is what stops the first adjustment after an SPA swap
			// from failing until the viewer repeats it.
			expect((await writing).target).toEqual(next.target);
			expect(next.element.playbackRate).toBe(2);
		} finally { executor.dispose(); }
	});

	test('applies an active-target intent to the selection when it names an identity this document never registered', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		const selection = registry.resolve();
		// A projection can be built against another runtime instance of the same
		// document. Its mediaId was minted by a counter that instance owned, so this
		// registry has never seen it; the viewer's tab is still the selection.
		registry.resolve = (requested?: MediaTarget | null) => !requested
			|| requested.mediaId === registry.target.mediaId ? selection : null;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			const result = await executor.execute({ intentId: 'volume:foreign-identity', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: { ...registry.target, mediaId: 'media:9:6' }, actualContext: {}, patch: { volumeBase: 40 } });
			expect(result.target).toEqual(registry.target);
			expect(registry.element.volume).toBeCloseTo(0.4, 5);
		} finally { executor.dispose(); }
	});

	test('applies an active-target intent to the selection when the projection names a superseded player', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry();
		const selection = registry.resolve();
		// Another player is still registered, so the projected mediaId resolves; it
		// is simply no longer what this tab controls. An active-target intent is
		// addressed to the tab, not to that historical element.
		const superseded = { ...selection.target, mediaId: 'media:1:3' };
		registry.resolve = (requested?: MediaTarget | null) => !requested
			? selection
			: requested.mediaId === selection.target.mediaId ? selection : { target: superseded, element: selection.element };
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			const result = await executor.execute({ intentId: 'volume:superseded-player', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: superseded, actualContext: {}, patch: { volumeBase: 35 } });
			expect(result.target).toEqual(registry.target);
			expect(registry.element.volume).toBeCloseTo(0.35, 5);
		} finally { executor.dispose(); }
	});

	test('keeps active-video acknowledgement valid when an independent audio source acquires activeMedia', async () => {
		installFakeMediaGlobals(); Object.defineProperty(globalThis, 'HTMLVideoElement', { configurable: true, value: FakeMediaElement });
		const registry = new FakeRegistry(); registry.target.kind = 'video'; const video = registry.resolve();
		const audio = { element: new FakeMediaElement() as unknown as HTMLMediaElement,
			target: { ...video.target, mediaId: 'media:independent-audio', kind: 'audio' as const } };
		let selected = video;
		registry.resolve = (requested?: MediaTarget | null) => requested?.mediaId === video.target.mediaId ? video : selected;
		Object.assign(registry, { resolveVideo: () => video });
		const effects = { dispose() {}, apply: async () => { selected = audio; registry.selectionRevision += 1; return 90; } };
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({ intentId: 'video:independent-selection', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target: null,
				actualContext: {}, patch: { rotation: 90 } });
			expect(result.target).toEqual(video.target); expect(result.fields.rotation?.actual).toBe(90);
			expect(registry.resolve(null)?.target).toEqual(audio.target);
		} finally { executor.dispose(); }
	});
	test('recognizes scene return only through the same unique declared root and observed route', async () => {
		installFakeMediaGlobals();
		const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
		let url = new URL('https://www.douyin.com/video/a'); let ambiguous = false;
		const media = new BridgedMediaElement(); const registry = new FakeRegistry(media);
		const root = { querySelectorAll: (selector: string) => selector.includes('video')
			? ambiguous ? [media, {}] : [media] : [] };
		Object.defineProperty(media, 'closest', { configurable: true, value: () => root });
		Object.defineProperty(globalThis, 'window', { configurable: true, value: { get location() { return url; } } });
		Object.defineProperty(globalThis, 'location', { configurable: true, get: () => url });
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		const set = (speed: number): ControlIntent => ({ intentId: `root:${speed}`, tabId: 7, documentId: registry.documentId,
			generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
			target: { ...registry.target }, actualContext: {}, patch: { speed } });
		const change = async (route: string): Promise<Record<string, unknown>> => {
			registry.emit('removed'); registry.target.sourceRevision += 1; url = new URL(route);
			messages.length = 0; registry.emit('registered'); registry.emit('selected');
			await new Promise((resolve) => setTimeout(resolve, 0));
			const restoreMessage = messages.find((message) => message.type === 'spectra.control.intent.submit');
			if (!restoreMessage) throw new Error('Expected current scene restore');
			return restoreMessage.payload.patch as Record<string, unknown>;
		};
		try {
			await executor.execute(set(2)); await change('https://www.douyin.com/live/b'); await executor.execute(set(1.5));
			expect((await change('https://www.douyin.com/video/a')).speed).toBe(2);
			expect((await change('https://www.douyin.com/live/b')).speed).toBe(1.5);
			ambiguous = true;
			// A multi-media root cannot claim the old scene preference. Only the
			// independent document fallback remains available for the exact target.
			expect((await change('https://www.douyin.com/video/a')).speed).toBe(1.5);
		} finally { executor.dispose(); restore('window', oldWindow); restore('location', oldLocation); }
	});
	test.each(['return', 'page-override', 'same-url', 'stale-token'] as const)(
		'keeps route-only scene restoration fenced on the same media source (%s)', async (scenario) => {
			installFakeMediaGlobals();
			const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
			const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
			let url = new URL('https://www.douyin.com/video/a');
			const media = new BridgedMediaElement();
			const registry = new FakeRegistry(media);
			const root = { querySelectorAll: (selector: string) => selector.includes('video') ? [media] : [] };
			Object.defineProperty(media, 'closest', { configurable: true, value: () => root });
			Object.defineProperty(globalThis, 'window', { configurable: true, value: { get location() { return url; } } });
			Object.defineProperty(globalThis, 'location', { configurable: true, get: () => url });
			const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
			Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
				id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
			} } });
			const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
			media.addEventListener('ratechange', () => registry.emit('ratechange'));
			const intent = (speed: number, source: ControlIntent['source'] = 'popup'): ControlIntent => ({
				intentId: `route-only:${source}:${speed}`, tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source, requestedCoverage: 'active-target',
				target: { ...registry.target }, actualContext: {}, patch: { speed },
			});
			const restoreRequest = (): ControlIntent | null => {
				const message = messages.find(value => value.type === 'spectra.control.intent.submit'
					&& value.payload.source === 'restore');
				return message ? { ...intent(0, 'restore'), ...message.payload } as ControlIntent : null;
			};
			const settle = async (route: string): Promise<ControlIntent | null> => {
				url = new URL(route);
				messages.length = 0;
				executor.reconcileRoute(route);
				await new Promise(resolve => setTimeout(resolve, 0));
				return restoreRequest();
			};
			try {
				const initialTarget = { ...registry.target };
				const initialVisit = registry.selectionRevision;
				await executor.execute(intent(2));
				if (scenario === 'same-url') {
					media.playbackRate = 1;
					await new Promise(resolve => setTimeout(resolve, 0));
					expect(await settle(url.href)).toBeNull();
					expect(media.playbackRate).toBe(1);
				} else if (scenario === 'stale-token') {
					messages.length = 0;
					registry.emit('selected');
					await new Promise(resolve => setTimeout(resolve, 0));
					const oldRestore = restoreRequest();
					if (!oldRestore) throw new Error('The previous scene restore token is missing');
					url = new URL('https://www.douyin.com/live/b');
					media.playbackRate = 1;
					await new Promise(resolve => setTimeout(resolve, 0));
					await expect(executor.execute(oldRestore)).rejects.toMatchObject({ code: 'stale-media-source' });
					expect(media.playbackRate).toBe(1);
				} else {
					url = new URL('https://www.douyin.com/live/b');
					await executor.execute(intent(1.5));
					if (scenario === 'page-override') {
						media.playbackRate = 1;
						await new Promise(resolve => setTimeout(resolve, 0));
					}
					const returning = await settle('https://www.douyin.com/video/a');
					if (!returning) throw new Error('The returning scene restore is missing');
					expect(returning.patch.speed).toBe(2);
					expect((await executor.execute(returning)).fields.speed?.actual).toBe(2);
					expect(registry.selectionRevision).toBe(initialVisit);
				}
				expect(registry.target).toEqual(initialTarget);
			} finally { executor.dispose(); restore('window', oldWindow); restore('location', oldLocation); }
		},
	);

	test('keeps exact-scene speeds independent and rejects an older automatic restore before writing', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry(); registry.target.mediaId = 'media:a';
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		const intent = (speed: number, source: ControlIntent['source'] = 'popup'): ControlIntent => ({
			intentId: `scene:${source}:${speed}`, tabId: 7, documentId: registry.documentId, generation: 1, baseRevision: 0,
			source, target: { ...registry.target }, requestedCoverage: 'active-target', actualContext: {}, patch: { speed },
		});
		const visit = async (id: string): Promise<ControlIntent> => {
			registry.target.mediaId = id; messages.length = 0; registry.emit('selected');
			await new Promise((resolve) => setTimeout(resolve, 0));
			const changed = messages.findIndex((message) => message.type === 'spectra.content.target.changed');
			const restored = messages.findIndex((message) => message.type === 'spectra.control.intent.submit');
			expect(changed).toBeGreaterThanOrEqual(0); expect(restored).toBeGreaterThan(changed);
			return { ...intent(0, 'restore'), ...messages[restored]?.payload } as ControlIntent;
		};
		try {
			await executor.execute(intent(2));
			await visit('media:b'); await executor.execute(intent(1.5));
			const a = await visit('media:a');
			expect(a.patch.speed).toBe(2); expect((await executor.execute(a)).fields.speed?.actual).toBe(2);
			const b = await visit('media:b');
			expect(b.patch.speed).toBe(1.5); expect((await executor.execute(b)).fields.speed?.actual).toBe(1.5);
			const older = await visit('media:a'); await executor.execute(intent(2.4));
			await expect(executor.execute(older)).rejects.toMatchObject({ code: 'stale-media-source' });
			expect(registry.element.playbackRate).toBe(2.4);
			expect((await executor.execute(intent(0.5, 'restore'))).fields.speed?.actual).toBe(2.4);
		} finally { executor.dispose(); }
	});

	test('resolves a playback toggle locally and performs one native write with an exact ACK', async () => {
		installFakeMediaGlobals(); const registry = new FakeRegistry(); let writes = 0;
		const pause = registry.element.pause.bind(registry.element);
		registry.element.pause = () => { writes += 1; pause(); };
		registry.element.paused = false;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			const result = await executor.togglePlayback({ operationId: 'local:toggle', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'hotkey', target: null, operation: 'playback-toggle', payload: {} });
			expect(writes).toBe(1); expect(result.actual).toBe(false); expect(result.target).toEqual(registry.target);
			expect(result.fields.playing).toMatchObject({ phase: 'applied', actual: false });
		} finally { executor.dispose(); }
	});
	test.each(['intercepted', 'replayed', 'selection-changed'] as const)('proves physical pause independently of event delivery (%s)', async (scenario) => {
		installFakeMediaGlobals();
		const media = new FakeMediaElement();
		media.paused = false;
		let writes = 0;
		media.addEventListener('pause', (event) => event.stopImmediatePropagation());
		media.pause = () => {
			writes += 1;
			media.paused = true;
			queueMicrotask(() => {
				if (scenario === 'replayed') media.paused = false;
				media.dispatchEvent(new Event('pause'));
			});
		};
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const operation = executor.execute({ intentId: 'pause:physical', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { playing: false } });
			if (scenario === 'selection-changed') registry.target.mediaId = 'media:another-active';
			if (scenario === 'selection-changed') await expect(operation).rejects.toMatchObject({ code: 'stale-media-source' });
			else {
				const ack = await operation;
				// A page that swallows the event still has to be seen by the readback,
				// and one that restarts playback is a failed pause — not a value to
				// dissolve into a later drift. The viewer pressed pause and the video
				// is still playing, so the transaction must say so (SCTRL-005).
				expect(ack.fields.playing).toMatchObject(scenario === 'intercepted'
					? { phase: 'applied', actual: false }
					: { phase: 'error', actual: null, lastError: { code: 'readback-mismatch' } });
			}
			expect(writes).toBe(1);
		} finally { executor.dispose(); }
	}, 2_000);

	test('witnesses a native volume gesture from the element even when the audio runtime owns output (I9)', async () => {
		installFakeMediaGlobals();
		const media = new FakeMediaElement();
		media.volume = 1;
		media.paused = false;
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		const submitted: Array<{ source?: string; patch?: Record<string, unknown>; userGesture?: boolean }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: { type: string; payload: { source?: string; patch?: Record<string, unknown>; userGesture?: boolean } }) => {
				if (message.type === 'spectra.control.intent.submit') submitted.push(message.payload);
				return { ok: true, data: { recorded: true } };
			},
		} } });
		executor.setAudioRuntimeDelegate({
			synchronizeNative() {},
			// Document-output mode reports the extension's applied policy; that value
			// does not move when the page's own UI does.
			read: () => ({ patch: { volumeBase: 100, mediaMuted: false }, observedStrategies: {} }),
			apply: async () => ({}),
		});
		try {
			registry.emit('registered');
			registry.emit('selected');
			await new Promise((resolve) => setTimeout(resolve, 0));
			media.forceVolume(0.4);
			registry.emit('volumechange');
			await new Promise((resolve) => setTimeout(resolve, 0));
			const page = submitted.filter(({ source }) => source === 'page');
			expect(page.at(-1)?.patch).toMatchObject({ volumeBase: 40, mediaMuted: false });
			// Autoplay setup and player scaffolding write volume without trusted input.
			expect(page.at(-1)?.userGesture).toBeUndefined();

			// A viewer dragging the site's own slider produces trusted input first.
			// That witness is what lets the badge appear without the Popup (I10).
			noteMediaUserGesture();
			media.forceVolume(0.3);
			registry.emit('volumechange');
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(submitted.filter(({ source }) => source === 'page').at(-1))
				.toMatchObject({ userGesture: true, patch: { volumeBase: 30 } });
		} finally { executor.dispose(); }
	});

	test('rejects playback ACK when selection changes after physical proof while the old source remains registered', async () => {
		installFakeMediaGlobals();
		const media = new FakeMediaElement();
		media.paused = false;
		const registry = new FakeRegistry(media);
		const source = registry.resolve();
		let selected = source;
		registry.resolve = (requested?: MediaTarget | null) => requested ? source : selected;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		executor.setAudioRuntimeDelegate({
			synchronizeNative() {},
			read: () => ({ patch: {}, observedStrategies: {} }),
			apply: async () => {
				selected = { element: source.element, target: { ...source.target, mediaId: 'media:next-selection' } };
				return {};
			},
		});
		try {
			await expect(executor.execute({ intentId: 'pause:late-selection', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { playing: false, boost: 2 } })).rejects.toMatchObject({ code: 'stale-media-source' });
			expect(media.paused).toBe(true);
		} finally { executor.dispose(); }
	});

	test('replays a retained speed on a new selection visit without fighting same-visit page changes', async () => {
		installFakeMediaGlobals();
		const media = new FakeMediaElement();
		const registry = new FakeRegistry(media);
		const messages: Array<{ type: string; payload?: { source?: string; patch?: { speed?: number } } }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test', sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		media.addEventListener('ratechange', () => registry.emit('ratechange'));
		try {
			await executor.execute({
				intentId: 'speed:before-live', tabId: 7, documentId: registry.documentId, generation: 1,
				baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target: registry.target,
				actualContext: {}, patch: { speed: 2 },
			});
			media.playbackRate = 1;
			await Promise.resolve();
			registry.emit('play');
			await Promise.resolve();
			expect(messages.filter((message) => message.payload?.source === 'restore')).toEqual([]);
			const feedId = registry.target.mediaId;
			registry.target.mediaId = 'media:live';
			registry.emit('selected');
			await new Promise((resolve) => setTimeout(resolve, 0));
			messages.length = 0;
			registry.target.mediaId = feedId;
			registry.emit('selected');
			await Promise.resolve();
			expect(messages.some((message) => message.payload?.source === 'restore' && message.payload.patch?.speed === 2)).toBe(true);
		} finally { executor.dispose(); }
	});

	test('acknowledges play before buffering completes so a later pause can run', async () => {
		installFakeMediaGlobals();
		const media = new FakeMediaElement();
		media.play = () => {
			media.paused = false;
			queueMicrotask(() => media.dispatchEvent(new Event('play')));
			return new Promise<void>(() => undefined);
		};
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		const intent = (playing: boolean): ControlIntent => ({
			intentId: `playback:${playing}`, tabId: 7, documentId: registry.documentId, generation: 1,
			baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target: registry.target,
			actualContext: {}, patch: { playing },
		});
		try {
			const play = await Promise.race([executor.execute(intent(true)), new Promise<null>((resolve) => setTimeout(() => resolve(null), 300))]);
			expect(play?.fields.playing).toMatchObject({ phase: 'applied', actual: true });
			expect((await executor.execute(intent(false))).fields.playing).toMatchObject({ phase: 'applied', actual: false });
		} finally { executor.dispose(); }
	}, 500);

	test('retains a native restore on a live MediaStream before its audio track arrives', async () => {
		installFakeMediaGlobals();
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
		class StartingStream {
			audio = false;
			getVideoTracks() { return [{}]; }
			getAudioTracks() { return this.audio ? [{}] : []; }
		}
		Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: StartingStream });
		const stream = new StartingStream();
		const registry = new FakeRegistry();
		Object.assign(registry.element, { srcObject: stream });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		try {
			const ack = await executor.execute({ intentId: 'cold:native-before-audio', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'restore', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { volumeBase: 40 } });
			expect(ack.fields.volumeBase).toMatchObject({ phase: 'applied', actual: 40, strategy: 'dom-native' });
			expect(executor.mediaIntentState()).toBe('retained');
			stream.audio = true;
			expect(registry.element.volume).toBe(0.4);
		} finally { executor.dispose(); restore('MediaStream', descriptor); }
	});

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
		// This case asserts the *verified* guarantee: the transaction itself must
		// reject when a page rolls the value back. The split-ack default moves
		// that proof off the critical path, so pin the historical mode here and
		// assert the new behaviour separately.
		configureNativeWritePolicy({ defaultMode: 'verified' });
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
		resetNativeWritePolicy();
	}, 5_000);

	test('rejects a getter match when no native event acknowledges the setter', async () => {
		// Same split-ack carve-out as the rollback case above: a missing native
		// event is only an error on the verified path, where the event *is* the
		// acknowledgement.
		configureNativeWritePolicy({ defaultMode: 'verified' });
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
			resetNativeWritePolicy();
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

	test('finishes an in-flight native seek when the same element swaps its source', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		let committed = 4;
		let seeking = false;
		Object.defineProperty(registry.element, 'currentTime', {
			configurable: true,
			get: () => committed,
			set: (value: number) => { committed = value; seeking = true; },
		});
		Object.defineProperty(registry.element, 'seeking', { configurable: true, get: () => seeking });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose: () => undefined } as unknown as VideoEffectsController);
		try {
			const writing = executor.execute({
				intentId: 'intent:seek-across-source-swap',
				tabId: 7,
				documentId: registry.target.documentId,
				generation: 1,
				baseRevision: 2,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { currentTime: 10 },
			});
			expect(seeking).toBe(true);
			// The live player swaps its stream while the native seek is still in
			// flight. The element is the same control target, so the write must
			// finish and revalidate instead of failing `stale-media-source` (SP-22.3 §1).
			registry.emit('removed', 'source-change');
			committed = 10;
			seeking = false;
			registry.element.dispatchEvent(new Event('seeked'));
			const result = await writing;
			expect(result.fields.currentTime).toMatchObject({ actual: 10, phase: 'applied' });
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

	test.each(['restore', 'popup'] as const)('rejects a targetless %s without false actual and retains only a restore template', async (source) => {
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
				source,
				requestedCoverage: 'active-target',
				target: null,
				actualContext: {},
				patch: { volumeBase: 40, speed: 1.5 },
			});
			expect(initial.fields.volumeBase?.phase).toBe('error');
			expect(initial.fields.speed?.phase).toBe('error');
			expect(initial.fields.speed?.actual).toBeNull();
			expect(initial.fields.speed?.controlled).toBe(false);

			available = true;
			listener?.({ ...target }, 'registered', element as unknown as HTMLMediaElement);
			expect(sent).not.toContainEqual(expect.objectContaining({ type: 'spectra.control.intent.submit' }));
			listener?.({ ...target }, 'selected', element as unknown as HTMLMediaElement);
			await Promise.resolve();
			if (source === 'popup') expect(sent).not.toContainEqual(expect.objectContaining({ type: 'spectra.control.intent.submit' }));
			else expect(sent).toContainEqual(expect.objectContaining({
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
				// The read also states the presentation kind it saw.
				live: false,
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

	test('holds the lifted disablePictureInPicture until the PiP session ends', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const registry = new FakeRegistry();
		registry.target.kind = 'video';
		const video = registry.element as FakeMediaElement & {
			disablePictureInPicture: boolean;
			requestPictureInPicture(): Promise<Record<string, never>>;
		};
		let disabled = true;
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: null as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				const previous = documentState.pictureInPictureElement;
				documentState.pictureInPictureElement = null;
				if (previous instanceof EventTarget) {
					queueMicrotask(() => previous.dispatchEvent(new Event('leavepictureinpicture')));
				}
			},
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		Object.defineProperty(video, 'disablePictureInPicture', {
			configurable: true,
			get: () => disabled,
			set: (value: boolean) => {
				disabled = value === true;
				// Chrome runs the exit-PiP algorithm when the attribute is re-added to
				// the element that already owns the session.
				if (disabled && documentState.pictureInPictureElement === video) {
					void documentState.exitPictureInPicture();
				}
			},
		});
		video.requestPictureInPicture = async () => {
			documentState.pictureInPictureElement = video;
			queueMicrotask(() => video.dispatchEvent(new Event('enterpictureinpicture')));
			return {};
		};
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:pip-attribute-ownership',
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
			expect(result.fields.pip).toMatchObject({ phase: 'applied', actual: true });
			expect(documentState.pictureInPictureElement).toBe(video);
			// The site's preference stays lifted for as long as the session lives.
			expect(disabled).toBe(false);

			documentState.pictureInPictureElement = null;
			video.dispatchEvent(new Event('leavepictureinpicture'));
			expect(disabled).toBe(true);
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

	test('answers a PiP request as written and proves the session afterwards', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		resetNativeWriteTelemetry();
		const video = new FakeMediaElement();
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document-pip-split-ack',
			mediaId: 'media:pip-split-ack',
			sourceRevision: 1,
			kind: 'video',
		};
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: null as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => {
				const previous = documentState.pictureInPictureElement;
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
		const executor = new NativeMediaExecutor(registry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({
				intentId: 'pip:split-ack',
				tabId: 7,
				documentId: target.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'popup',
				requestedCoverage: 'active-target',
				target,
				actualContext: {},
				patch: { pip: true },
			});
			// The session owner is the acknowledgement; the stabilization window is
			// a separate fact (SCTRL-045) that must not delay the answer.
			expect(result.fields.pip).toMatchObject({ phase: 'applied', actual: true, writeState: 'written' });
			expect(snapshotNativeWriteTelemetry().pending).toBe(1);
			await new Promise((resolve) => { setTimeout(resolve, 250); });
			expect(snapshotNativeWriteTelemetry().pending).toBe(0);
			expect(snapshotNativeWriteTelemetry().byState.drifted).toBe(0);
		} finally {
			executor.dispose();
			resetNativeWriteTelemetry();
		}
	}, 2_000);

	test('answers a fullscreen request as written and proves ownership afterwards', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		resetNativeWriteTelemetry();
		const media = new FakeMediaElement();
		const documentState = {
			pictureInPictureEnabled: false,
			pictureInPictureElement: null,
			fullscreenElement: null as unknown,
			exitFullscreen: async () => {
				const previous = documentState.fullscreenElement;
				documentState.fullscreenElement = null;
				if (previous instanceof EventTarget) {
					queueMicrotask(() => previous.dispatchEvent(new Event('fullscreenchange')));
				}
			},
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		(media as FakeMediaElement & { requestFullscreen(): Promise<void> }).requestFullscreen = async () => {
			documentState.fullscreenElement = media;
			queueMicrotask(() => media.dispatchEvent(new Event('fullscreenchange')));
		};
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({
				intentId: 'fullscreen:split-ack',
				tabId: 7,
				documentId: registry.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { fullscreen: true },
			});
			expect(result.fields.fullscreen).toMatchObject({ phase: 'applied', actual: true, writeState: 'written' });
			expect(snapshotNativeWriteTelemetry().pending).toBe(1);
			await new Promise((resolve) => { setTimeout(resolve, 250); });
			expect(snapshotNativeWriteTelemetry().pending).toBe(0);
			expect(snapshotNativeWriteTelemetry().byState.drifted).toBe(0);
		} finally {
			executor.dispose();
			resetNativeWriteTelemetry();
		}
	}, 2_000);

	test('settles a standard-DOM speed write before answering so a page source swap cannot erase it', async () => {
		installFakeMediaGlobals();
		resetNativeWriteTelemetry();
		const registry = new FakeRegistry();
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({
				intentId: 'speed:awaited-ack',
				tabId: 7,
				documentId: registry.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 1.75 },
			});
			expect(result.fields.speed).toMatchObject({ phase: 'applied', actual: 1.75 });
			expect(registry.element.playbackRate).toBe(1.75);
			// The answer already includes the settle window: nothing is left in
			// flight to book a later drift against a value the viewer never saw.
			expect(snapshotNativeWriteTelemetry().pending).toBe(0);
			expect(snapshotNativeWriteTelemetry().byState.drifted).toBe(0);
		} finally {
			executor.dispose();
			resetNativeWriteTelemetry();
		}
	}, 2_000);

	test('refuses a speed write on a live presentation before touching the element', async () => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			// A live MSE presentation reports an unbounded duration. Writing the rate
			// anyway is what used to answer `readback-mismatch` seconds later, after
			// the player had already reverted it.
			registry.element.duration = Number.POSITIVE_INFINITY;
			const result = await executor.execute({
				intentId: 'speed:live',
				tabId: 7,
				documentId: registry.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: registry.target,
				actualContext: {},
				patch: { speed: 2 },
			});
			expect(result.fields.speed).toMatchObject({
				phase: 'error',
				actual: null,
				strategy: 'unsupported',
				lastError: { code: 'capability-unavailable', retryable: false },
			});
			expect(registry.element.playbackRate).toBe(1);
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test.each(['loadedmetadata', 'loadeddata', 'durationchange'] as const)('announces only the selected live presentation when %s makes it a fact', async (event) => {
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
		Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
			id: 'spectra-test',
			sendMessage: async (message: typeof messages[number]) => { messages.push(message); },
		} } });
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as VideoEffectsController);
		const liveMessages = () => messages.filter((message) => message.type === 'spectra.control.intent.submit'
			&& message.payload.live === true && Object.keys(message.payload.patch as object).length === 0);
		try {
			// An on-demand element says nothing: it is the default, and announcing it
			// would send one message per element per document.
			registry.emit('loadedmetadata');
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(liveMessages()).toHaveLength(0);

			registry.element.duration = Number.POSITIVE_INFINITY;
			const other = new FakeMediaElement();
			other.duration = Number.POSITIVE_INFINITY;
			const otherTarget: MediaTarget = { ...registry.target, mediaId: 'media:inactive-live', kind: 'video' };
			registry.listener?.(otherTarget, event, other as unknown as HTMLMediaElement);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(liveMessages()).toHaveLength(0);
			// The previously ignored source must still publish when it is selected.
			Object.assign(registry.target, otherTarget);
			registry.emit(event);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(liveMessages()).toHaveLength(1);
			expect(liveMessages()[0]?.payload).toMatchObject({
				source: 'page', requestedCoverage: 'active-target', target: registry.target, patch: {}, live: true,
			});

			// The same fact on the next event is not news.
			registry.emit('play');
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(liveMessages()).toHaveLength(1);
		} finally {
			executor.dispose();
		}
	});

	test('reports a session the page terminated in the same task as a policy denial', async () => {
		Object.defineProperty(globalThis, 'HTMLMediaElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeMediaElement,
		});
		const video = new FakeMediaElement();
		const target: MediaTarget = {
			frameId: 0,
			documentId: 'document-pip-veto',
			mediaId: 'media:pip-veto',
			sourceRevision: 1,
			kind: 'video',
		};
		const documentState = {
			pictureInPictureEnabled: true,
			pictureInPictureElement: null as unknown,
			fullscreenElement: null,
			exitPictureInPicture: async () => { documentState.pictureInPictureElement = null; },
		};
		Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
		(video as FakeMediaElement & {
			requestPictureInPicture(): Promise<Record<string, never>>;
		}).requestPictureInPicture = async () => {
			documentState.pictureInPictureElement = video;
			// The page accepts the request and closes the window before the request
			// promise resolves. That is a site veto, not a readback mismatch.
			queueMicrotask(() => { documentState.pictureInPictureElement = null; });
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
		const executor = new NativeMediaExecutor(registry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({
				intentId: 'pip:vetoed',
				tabId: 7,
				documentId: target.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'popup',
				requestedCoverage: 'active-target',
				target,
				actualContext: {},
				patch: { pip: true },
			});
			expect(result.fields.pip).toMatchObject({
				phase: 'error',
				actual: null,
				lastError: { code: 'policy-denied', retryable: false },
			});
		} finally {
			executor.dispose();
		}
	}, 2_000);

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

	test('reads page-semantic volume and mute while physical speed remains authoritative', () => {
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
			expect(result.patch).toMatchObject({ volumeBase: 100, mediaMuted: false, speed: 1 });
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

	test.each(['stable', 'selection-change', 'source-change'] as const)('reports cold page-semantic volume from the queued element itself (%s)', async (transition) => {
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
			state.volumeBase = 50;
			media.forceVolume(0.30655);
			registry.emit('volumechange');
			if (transition === 'selection-change') registry.target.mediaId = 'media:next';
			if (transition === 'source-change') registry.target.sourceRevision += 1;
			if (transition !== 'stable') registry.emit('selected');
			await Promise.resolve();
			const observation = messages.find((message) => message.type === 'spectra.control.intent.submit');
			expect(observation?.payload?.patch).toMatchObject({ volumeBase: 50, mediaMuted: false });
			expect(observation?.payload?.observedStrategies).toEqual({
				volumeBase: 'page-native',
				mediaMuted: 'page-native',
			});
			expect(observation?.payload).not.toHaveProperty('tabId');
			if (transition !== 'stable') {
				expect(messages.some((message) => message.type === 'spectra.content.target.changed')).toBe(true);
			}
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

	test('waits for a lagging media element before confirming a page speed write', async () => {
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
		// The controller commits first; physical playback catches up later.
		media.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, () => {
			const request = JSON.parse(
				media.getAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE) ?? '{}',
			) as Partial<SpectraPageMediaRequest>;
			if (!request.requestId || !request.field || !request.operation) return;
			if (request.operation === 'write'
				&& request.field === 'speed'
				&& typeof request.value === 'number') {
				state.speed = request.value;
				const physicalRate = request.value;
				setTimeout(() => { media.playbackRate = physicalRate; }, 150);
			}
			const result: SpectraPageMediaResult = {
				requestId: request.requestId,
				field: request.field,
				supported: true,
				actual: state[request.field],
			};
			media.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
		});
		const registry = new FakeRegistry(media);
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:page-media:lagging-media',
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
			expect(result.fields.speed).toMatchObject({
				phase: 'applied',
				strategy: 'page-native',
				actual: 1.5,
			});
			expect(state.speed).toBe(1.5);
			expect(media.playbackRate).toBe(1.5);
		} finally {
			executor.dispose();
		}
	}, 2_000);

	test.each([false, true])('falls back for a free speed the controller claims but never plays (page already owned: %s)', async (alreadyOwned) => {
		installFakeMediaGlobals();
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1, acceptedButClampedSpeed: 1.25, speedWriteCount: 0 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		const intent = (speed: number): ControlIntent => ({
			intentId: `physical-speed:${speed}`, tabId: 7, documentId: registry.documentId,
			generation: 1, baseRevision: 1, source: 'popup', requestedCoverage: 'active-target',
			target: registry.target, actualContext: {}, patch: { speed },
		});
		try {
			if (alreadyOwned) expect((await executor.execute(intent(1.5))).fields.speed?.strategy).toBe('page-native');
			const result = await executor.execute(intent(1.3));
			expect(result.fields.speed).toMatchObject({ phase: 'applied', strategy: 'dom-native', actual: 1.3 });
			expect(media.playbackRate).toBe(1.3);
			expect(executor.read({ target: registry.target, fields: ['speed'] })).toMatchObject({
				patch: { speed: 1.3 }, observedStrategies: { speed: 'dom-native' },
			});
			const pageWrites = state.speedWriteCount;
			await executor.execute(intent(1.3));
			expect(state.speedWriteCount).toBe(pageWrites);
			const replayed: Array<{ payload?: { patch?: { speed?: number } } }> = [];
			Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
				id: 'spectra-test', sendMessage: async (message: { payload?: { patch?: { speed?: number } } }) => { replayed.push(message); },
			} } });
			registry.emit('loadedmetadata');
			await Promise.resolve();
			expect(replayed).toEqual([]);
			media.playbackRate = 1.25;
			registry.emit('loadedmetadata');
			await Promise.resolve();
			expect(replayed.some((message) => message.payload?.patch?.speed === 1.3)).toBe(true);
			media.playbackRate = 1.3;
			const released = await executor.releasePageSettings({
				operationId: 'physical-speed:release', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 3, source: 'popup', target: registry.target,
				operation: 'restore-page-settings', payload: {},
			});
			expect(released.fields.speed?.actual).toBe(1);
			expect(media.playbackRate).toBe(1);
		} finally { executor.dispose(); }
	}, 4_000);

	test('observes physical speed when the page getter disagrees before a write', () => {
		installFakeMediaGlobals();
		const media = new BridgedMediaElement();
		media.playbackRate = 1.3;
		installPageMediaBridgeStub(media, { volumeBase: 100, mediaMuted: false, speed: 1.5 });
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			expect(executor.read({ target: registry.target, fields: ['speed'] })).toMatchObject({
				patch: { speed: 1.3 }, observedStrategies: { speed: 'dom-native' },
			});
		} finally { executor.dispose(); }
	});

	test('accepts consecutive different free speeds beyond the page range and preserves the original release baseline', async () => {
		installFakeMediaGlobals();
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1, maximumSpeed: 2 };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			for (const speed of [4, 5, 1.75]) {
				const result = await executor.execute({
					intentId: `speed:consecutive:${speed}`, tabId: 7, documentId: registry.documentId, generation: 1,
					baseRevision: 1, source: 'popup', requestedCoverage: 'active-target',
					target: registry.target, actualContext: {}, patch: { speed },
				});
				expect(result.fields.speed).toMatchObject({ phase: 'applied', actual: speed, strategy: speed > 2 ? 'dom-native' : 'page-native' });
				expect(media.playbackRate).toBe(speed);
			}
			const released = await executor.releasePageSettings({
				operationId: 'speed:consecutive:release', tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 3, source: 'popup', target: registry.target,
				operation: 'restore-page-settings', payload: {},
			});
			expect(released.fields.speed?.actual).toBe(1);
			expect(media.playbackRate).toBe(1);
		} finally { executor.dispose(); }
	}, 5_000);

	test('rejects a controller-only rollback at the last render boundary before accepting speed', async () => {
		installFakeMediaGlobals();
		const media = new BridgedMediaElement();
		const state: PageMediaState = { volumeBase: 100, mediaMuted: false, speed: 1 };
		installPageMediaBridgeStub(media, state);
		let frames = 0;
		Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => {
			frames += 1;
			if (frames === 2) state.speed = 1;
			callback(performance.now());
		}, 0) });
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		try {
			const result = await executor.execute({
				intentId: 'speed:render-bounce', tabId: 7, documentId: registry.documentId, generation: 1,
				baseRevision: 1, source: 'popup', requestedCoverage: 'active-target',
				target: registry.target, actualContext: {}, patch: { speed: 1.3 },
			});
			expect(result.fields.speed).toMatchObject({ phase: 'applied', strategy: 'dom-native', actual: 1.3 });
			expect(state.speed).toBe(1);
			expect(media.playbackRate).toBe(1.3);
		} finally { executor.dispose(); }
	});

	test.each([false, true])('explicit unmute follows browser policy without document activation (page: %s)', async (pageSide) => {
		installFakeMediaGlobals();
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { hasBeenActive: false } } });
		for (const source of ['popup', 'hotkey', 'remote'] as const) {
			for (const stopsPlayback of [false, true]) {
				const media = new BridgedMediaElement();
				media.muted = true;
				media.paused = false;
				let playCalls = 0;
				media.play = () => { playCalls += 1; return Promise.resolve(); };
				media.mutedWriteHook = value => { if (!value && stopsPlayback) queueMicrotask(() => { media.paused = true; }); };
				const state: PageMediaState = { volumeBase: 100, mediaMuted: true, speed: 1, supported: pageSide };
				installPageMediaBridgeStub(media, state);
				const registry = new FakeRegistry(media);
				const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
				try {
					const result = await executor.execute({
						intentId: `unmute:${source}:${stopsPlayback}`, tabId: 7, documentId: registry.documentId,
						generation: 1, baseRevision: 1, source, requestedCoverage: 'active-target',
						target: registry.target, actualContext: {}, patch: { mediaMuted: false },
					});
					expect(result.fields.mediaMuted).toMatchObject(stopsPlayback
						? { phase: 'error', lastError: { code: 'policy-denied', retryable: false } }
						: { phase: 'applied', actual: false, writeState: 'confirmed' });
					expect(media.muted).toBe(stopsPlayback);
					expect(media.paused).toBe(stopsPlayback);
					expect(playCalls).toBe(0);
				} finally { executor.dispose(); }
			}
		}
	}, 10_000);

	test.each([false, true])('blocks unactivated unmute before any writer while restoring speed (page: %s)', async (pageSide) => {
		installFakeMediaGlobals();
		const activation = { hasBeenActive: false };
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: activation } });
		const media = new BridgedMediaElement();
		media.muted = true;
		media.paused = false;
		let unmuteWrites = 0;
		media.mutedWriteHook = (value) => { if (!value) { unmuteWrites += 1; if (!activation.hasBeenActive) media.paused = true; } };
		const state: PageMediaState = { volumeBase: 100, mediaMuted: true, speed: 1, supported: pageSide };
		installPageMediaBridgeStub(media, state);
		const registry = new FakeRegistry(media);
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, { dispose() {} } as unknown as VideoEffectsController);
		const intent: ControlIntent = {
			intentId: 'autoplay:restore', tabId: 7, documentId: registry.documentId, generation: 1,
			baseRevision: 1, source: 'restore', requestedCoverage: 'active-target',
			target: registry.target, actualContext: {}, patch: { mediaMuted: false, speed: 1.3 },
		};
		try {
			const result = await executor.execute(intent);
			expect(result.fields.mediaMuted).toMatchObject({ phase: 'error', lastError: { code: 'user-activation-required', retryable: false } });
			expect(result.fields.speed).toMatchObject({ phase: 'applied', actual: 1.3 });
			expect(unmuteWrites).toBe(0);
			expect(media.muted).toBe(true);
			expect(media.paused).toBe(false);
			expect(() => writeNativeMediaMuted(media as unknown as HTMLMediaElement, false)).toThrow();
			activation.hasBeenActive = true;
			const explicit = await executor.execute({ ...intent, intentId: 'autoplay:explicit', source: 'popup', patch: { mediaMuted: false } });
			expect(explicit.fields.mediaMuted).toMatchObject({ phase: 'applied', actual: false });
			expect(media.paused).toBe(false);
		} finally { executor.dispose(); }
	}, 4_000);

	test.each([false, true])('upgrades a DOM-owned restore when a page controller appears later in the same document (route settled %s)', async (routeSettled) => {
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
			if (routeSettled) {
				let automatic: Promise<Awaited<ReturnType<NativeMediaExecutor['execute']>>> | undefined;
				Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
					id: 'spectra-test',
					sendMessage: async (message: { type: string; payload: Partial<ControlIntent> }) => {
						if (message.type !== 'spectra.control.intent.submit' || message.payload.source !== 'restore') {
							return { ok: true, data: { recorded: true } };
						}
						automatic = executor.execute({
							intentId: 'route:late-controller', tabId: 7, documentId: registry.documentId,
							generation: 1, baseRevision: 2, actualContext: {}, ...message.payload,
						} as ControlIntent);
						return { ok: true, data: await automatic };
					},
				} } });
				executor.reconcileRoute('https://fixture.example/modal');
				if (!automatic) throw new Error('Route settlement must schedule the retained speed upgrade');
				expect((await automatic).fields.speed).toMatchObject({ phase: 'applied', strategy: 'page-native', actual: 2 });
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(state.speedWriteCount).toBe(1);
				expect(state.speed).toBe(2);
				expect(media.playbackRate).toBe(2);
				executor.reconcileRoute('https://fixture.example/modal');
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(state.speedWriteCount).toBe(1);
			}
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
			expect(state.speedWriteCount).toBe(routeSettled ? 2 : 1);
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
			// Restore each channel's own baseline: page 1x, existing DOM 1.5x.
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

	test('answers a standard-DOM volume write as written without waiting for stabilization', async () => {
		resetNativeWritePolicy();
		resetNativeWriteTelemetry();
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		const startedAt = performance.now();
		try {
			const result = await executor.execute({
				intentId: 'intent:split-ack',
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
			// The entire point of the split: the control path no longer pays the
			// 64ms event-quiet window plus two render boundaries. The verified
			// path takes longer than this budget by construction.
			expect(performance.now() - startedAt).toBeLessThan(50);
			expect(result.fields.volumeBase).toMatchObject({
				phase: 'applied',
				writeState: 'written',
				controlled: true,
			});
			expect(registry.element.volume).toBeCloseTo(0.4, 5);
		} finally {
			executor.dispose();
			resetNativeWritePolicy();
			resetNativeWriteTelemetry();
		}
	}, 2_000);

	test('confirms a well-behaved write after the boundary and keeps the site optimistic', async () => {
		resetNativeWritePolicy();
		resetNativeWriteTelemetry();
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			await executor.execute({
				intentId: 'intent:split-ack-confirm',
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
			await settleConfirmationWindow();
			const telemetry = snapshotNativeWriteTelemetry();
			expect(telemetry.byState.confirmed).toBe(1);
			expect(telemetry.byState.drifted).toBe(0);
			expect(resolveNativeWriteMode(resolveNativeWriteSiteKey())).toBe('optimistic');
		} finally {
			executor.dispose();
			resetNativeWritePolicy();
			resetNativeWriteTelemetry();
		}
	}, 5_000);

	test('records a late page rollback as drift and demotes that site to verified', async () => {
		resetNativeWritePolicy();
		resetNativeWriteTelemetry();
		// One proven rollback is enough here so the demotion is observable without
		// staging two drags; the production threshold stays at two.
		configureNativeWritePolicy({ defaultMode: 'optimistic', driftLimit: 1 });
		installFakeMediaGlobals();
		const observations: Array<{ type?: string; payload?: { patch?: Record<string, unknown> } }> = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage: async (message: typeof observations[number]) => {
				observations.push(message);
				return undefined;
			} } },
		});
		const registry = new FakeRegistry();
		registry.element.volumeWriteHook = (value) => {
			if (Math.abs(value - 0.4) > 0.001) return;
			setTimeout(() => registry.element.forceVolume(1), 50);
		};
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			const result = await executor.execute({
				intentId: 'intent:split-ack-drift',
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
			// The transaction itself still succeeded: the rollback is reported,
			// not thrown, so a hostile page cannot regress the control path.
			expect(result.fields.volumeBase?.writeState).toBe('written');
			// The ack is re-validated after it crosses the process boundary. Asserting
			// only the fields this test cares about is precisely how a new optional
			// key reached production while every test stayed green: Background
			// rejected every native write as an invalid response, and the popup fell
			// back to the last confirmed value, which the user sees as a spring-back.
			expect(isControlApplyAck(result)).toBe(true);
			await settleConfirmationWindow();
			expect(snapshotNativeWriteTelemetry().byState.drifted).toBe(1);
			expect(observations.find((message) => message.type === 'spectra.control.intent.submit')?.payload?.patch)
				.toEqual({ volumeBase: 100, mediaMuted: false });
			expect(resolveNativeWriteMode(resolveNativeWriteSiteKey())).toBe('verified');
		} finally {
			executor.dispose();
			resetNativeWritePolicy();
			resetNativeWriteTelemetry();
		}
	}, 5_000);

	test('a page that never emits the native event keeps the site optimistic', async () => {
		resetNativeWritePolicy();
		resetNativeWriteTelemetry();
		configureNativeWritePolicy({ defaultMode: 'optimistic', driftLimit: 1 });
		installFakeMediaGlobals();
		const registry = new FakeRegistry();
		// DRM/EME-shaped media: the setter takes, the event never fires. The
		// deferred proof must not mistake silence for a rollback.
		registry.element.emitVolumeChange = false;
		const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
		const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
		try {
			await executor.execute({
				intentId: 'intent:split-ack-silent',
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
			await new Promise((resolve) => setTimeout(resolve, 900));
			expect(snapshotNativeWriteTelemetry().pending).toBe(0);
			expect(snapshotNativeWriteTelemetry().byState.unconfirmed).toBe(0);
			expect(resolveNativeWriteMode(resolveNativeWriteSiteKey())).toBe('optimistic');
		} finally {
			executor.dispose();
			resetNativeWritePolicy();
			resetNativeWriteTelemetry();
		}
	}, 5_000);
});

function settleConfirmationWindow(): Promise<void> {
	// Past the 64ms event-quiet window plus two render boundaries, with room for
	// the 50ms rollback the drift case stages.
	return new Promise((resolve) => setTimeout(resolve, 500));
}

function installFakeMediaGlobals(): void {
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
}

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
