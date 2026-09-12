// goal: sole DOM/browser writer with per-target intent correlation and actual readback

import {
	SPECTRA_PROTOCOL_VERSION,
	CONTROL_VALUE_LIMITS,
	clampControlValue,
	isSpectraRequestEnvelope,
	rpcFailure,
	rpcSuccess,
	type ControlApplyAck,
	type ControlActualContext,
	type ControlField,
	type ControlFieldStates,
	type ControlIntent,
	type ControlOperationIntent,
	type ControlFrameStepResult,
	type ControlNativeObservationStrategies,
	type ControlPatch,
	type ControlReadRequest,
	type ControlReadResult,
	type ControlStrategy,
	type ControlStrategyFailure,
	type ControlValues,
	type MediaTarget,
} from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/spectra-client';
import type {
	MediaRegistry,
	MediaRegistryEvent,
	MediaRegistryRemovalReason,
} from '../core/media-registry';
import {
	assertNotAborted,
	ContentLifecycleError,
	isContentLifecycleError,
} from '../core/content-runtime-context';
import type {
	VideoEffectsController,
	VideoEffectState,
} from '../video/video-effects-controller';
import { contentControlStrategy } from './content-control-policy';
import {
	assertNativeOperationCurrent,
	clampNativeSeek,
	clearNativeMediaAsyncState,
	consumeOwnedSeek,
	measureVideoFrameDuration,
	nativeValuesMatch,
	seekNativeMedia,
	stablePageReadback,
	stableReadback,
	writeWithStableEventAck,
	type NativeMediaOperationOptions,
} from './native-media-async';
import {
	probePageMediaCapability,
	readPageMediaField,
	writePageMediaField,
} from './page-media-bridge';
import {
	SPECTRA_PAGE_MEDIA_FIELDS,
	type SpectraPageMediaField,
} from '../../shared/page-media-bridge';

interface PendingWrite {
	intentId: string;
	revision: number;
	expected: unknown;
	tolerance: number;
	timeoutId: ReturnType<typeof setTimeout>;
}

type RestorableMediaField = 'volumeBase' | 'mediaMuted' | 'speed' | 'preservePitch' | 'loop';
type RestorableMediaWriter = 'page-native' | 'dom-native';

class PageMediaCapabilityUnavailableError extends Error {
	constructor(field: SpectraPageMediaField) {
		super(`Page-media ${field} writer is no longer available`);
		this.name = 'PageMediaCapabilityUnavailableError';
	}
}

interface OwnedMediaField {
	baseline: ControlValues[RestorableMediaField];
	lastApplied: ControlValues[RestorableMediaField];
	writer: RestorableMediaWriter;
}

interface RestorableMediaWriteState {
	actual: ControlValues[RestorableMediaField];
	writer: RestorableMediaWriter;
	upgradeFrom?: OwnedMediaField;
}

interface NativeMediaOwnershipStore {
	byElement: WeakMap<HTMLMediaElement, Map<RestorableMediaField, OwnedMediaField>>;
}

type VideoEffectsControllerPort = Pick<VideoEffectsController,
	'apply' | 'dispose' | 'release' | 'snapshot'> & {
	retireSource?: VideoEffectsController['retireSource'];
};

interface VideoEffectApplyOptions {
	signal?: AbortSignal;
	deadlineMs?: number;
	isCurrent?: () => boolean;
}

interface VideoEffectsRuntimeModule {
	VideoEffectsController: new () => VideoEffectsControllerPort;
}

const DEFAULT_VIDEO_EFFECT_STATE: Readonly<VideoEffectState> = Object.freeze({
	rotation: 0,
	mirrored: false,
	fill: false,
	filterEnabled: false,
	filter: Object.freeze({
		brightness: 100,
		contrast: 100,
		saturate: 100,
		grayscale: false,
		invert: false,
	}),
	dimEnabled: false,
	dimOpacity: 0.7,
});

let videoEffectsRuntimePromise: Promise<VideoEffectsRuntimeModule> | null = null;

function loadVideoEffectsRuntime(): Promise<VideoEffectsRuntimeModule> {
	videoEffectsRuntimePromise ??= import(chrome.runtime.getURL('content-video-effects.js'))
		.then((module) => module as VideoEffectsRuntimeModule)
		.catch((error) => {
			videoEffectsRuntimePromise = null;
			throw error;
		});
	return videoEffectsRuntimePromise;
}

const ownershipScope = globalThis as typeof globalThis & {
	__nexusSpectraNativeMediaOwnershipV3?: NativeMediaOwnershipStore;
};
const nativeMediaOwnership = ownershipScope.__nexusSpectraNativeMediaOwnershipV3
	?? { byElement: new WeakMap<HTMLMediaElement, Map<RestorableMediaField, OwnedMediaField>>() };
ownershipScope.__nexusSpectraNativeMediaOwnershipV3 = nativeMediaOwnership;

export interface AudioRuntimeControlDelegate {
	apply(intent: ControlIntent, patch: ControlPatch): Promise<ControlFieldStates>;
	read(fields: readonly ControlField[]): ControlPatch;
	readAudioVolume?(volumeBase: number, muted: boolean): NonNullable<ControlApplyAck['audioVolume']>;
	synchronizeNative(context: ControlActualContext): void;
	runFullscreenTransition?<T>(operation: () => Promise<T>): Promise<T>;
}

const VIDEO_EFFECT_FIELDS = new Set<ControlField>([
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
]);

const AUDIO_RUNTIME_FIELDS = new Set<ControlField>([
	'audioEnabled',
	'boost',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
]);

const RESTORABLE_MEDIA_FIELDS = new Set<ControlField>([
	'volumeBase',
	'mediaMuted',
	'speed',
	'preservePitch',
	'loop',
]);

function isRestorableMediaField(field: ControlField): field is RestorableMediaField {
	return RESTORABLE_MEDIA_FIELDS.has(field);
}

function fullscreenOwnsMedia(element: HTMLMediaElement): boolean {
	const owner = document.fullscreenElement;
	return owner === element
		|| typeof Element !== 'undefined' && owner instanceof Element && owner.contains(element);
}

function resolvePictureInPictureOwner(
	registry: MediaRegistry,
): ReturnType<MediaRegistry['resolveVideo']> {
	const owner = document.pictureInPictureElement;
	if (!(owner instanceof HTMLVideoElement)) return null;
	const registered = registry.list().find(({ element }) => element === owner);
	return registered?.element instanceof HTMLVideoElement
		? { element: registered.element, target: registered.target }
		: null;
}

function isPageMediaField(field: RestorableMediaField): field is SpectraPageMediaField {
	return field === 'volumeBase' || field === 'mediaMuted' || field === 'speed';
}

function readDomRestorableMediaField(
	element: HTMLMediaElement,
	field: RestorableMediaField,
): ControlValues[RestorableMediaField] {
	switch (field) {
		case 'volumeBase': return Math.round(element.volume * 10_000) / 100;
		case 'mediaMuted': return element.muted;
		case 'speed': return element.playbackRate;
		case 'preservePitch': {
			if (!('preservesPitch' in element)) throw new Error('Pitch preservation is unsupported');
			return (element as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch;
		}
		case 'loop': return element.loop;
	}
}

function readRestorableMediaField(
	element: HTMLMediaElement,
	field: RestorableMediaField,
	writer: RestorableMediaWriter,
): ControlValues[RestorableMediaField] {
	if (writer === 'page-native' && isPageMediaField(field)) {
		const actual = readPageMediaField(element, field);
		if (actual === null) throw new Error(`Page-media ${field} reader is no longer available`);
		return actual;
	}
	return readDomRestorableMediaField(element, field);
}

function readRestorableMediaFieldWithWriter(
	element: HTMLMediaElement,
	field: RestorableMediaField,
): { actual: ControlValues[RestorableMediaField]; writer: RestorableMediaWriter } {
	const owned = nativeMediaOwnership.byElement.get(element)?.get(field);
	// A DOM-owned high speed may intentionally exceed the page controller's UI
	// range, so its later reads must stay on playbackRate until an actual DOM
	// ratechange releases ownership. Volume/mute retain semantic page-gesture
	// discovery because their controller values can intentionally differ from
	// the media element projection.
	if (owned && (
		!isPageMediaField(field)
		|| (owned.writer === 'dom-native' && field === 'speed')
	)) {
		return {
			actual: readRestorableMediaField(element, field, owned.writer),
			writer: owned.writer,
		};
	}
	if (isPageMediaField(field)) {
		try {
			const actual = readPageMediaField(element, field);
			if (actual !== null) return { actual, writer: 'page-native' };
		} catch {
			// A broken or transient page controller does not suppress the standard
			// media fallback. No page write has occurred during this read probe.
			return { actual: readDomRestorableMediaField(element, field), writer: 'dom-native' };
		}
	}
	return { actual: readDomRestorableMediaField(element, field), writer: 'dom-native' };
}

function readRestorableMediaFieldForWrite(
	element: HTMLMediaElement,
	field: RestorableMediaField,
): RestorableMediaWriteState {
	const owned = nativeMediaOwnership.byElement.get(element)?.get(field);
	if (owned) {
		if (owned.writer === 'dom-native' && isPageMediaField(field)) {
			try {
				const actual = readPageMediaField(element, field);
				if (actual !== null) {
					return {
						actual,
						writer: 'page-native',
						upgradeFrom: owned,
					};
				}
			} catch {
				// Capability discovery is a read-only probe. A controller that is
				// incomplete while a SPA player is mounting leaves the acknowledged
				// DOM writer untouched until a later exact-source intent can prove it.
				return {
					actual: readRestorableMediaField(element, field, owned.writer),
					writer: owned.writer,
				};
			}
		}
		return {
			actual: readRestorableMediaField(element, field, owned.writer),
			writer: owned.writer,
		};
	}
	return readRestorableMediaFieldWithWriter(element, field);
}

function writeRestorableMediaField(
	element: HTMLMediaElement,
	field: RestorableMediaField,
	value: ControlValues[RestorableMediaField],
	writer: RestorableMediaWriter,
): ControlValues[RestorableMediaField] {
	if (writer === 'page-native' && isPageMediaField(field)) {
		const actual = writePageMediaField(element, field, value);
		if (actual === null) throw new PageMediaCapabilityUnavailableError(field);
		return actual;
	}
	switch (field) {
		case 'volumeBase': return writeNativeVolumeBase(element, value as number);
		case 'mediaMuted': return writeNativeMediaMuted(element, value as boolean);
		case 'speed': return writeNativePlaybackRate(element, value as number);
		case 'preservePitch': return writeNativePreservesPitch(element, value as boolean);
		case 'loop': return writeNativeLoop(element, value as boolean);
	}
}

// These remaining synchronous primitives are the only standard-media property
// writers owned by this executor. The bounded seek writer lives in
// native-media-async.ts, so static checks can still reject a second
// playback/volume/seek owner immediately.
export function writeNativeVolumeBase(element: HTMLMediaElement, volumeBase: number): number {
	element.volume = clampControlValue(volumeBase, 'volumeBase', 100) / 100;
	return element.volume * 100;
}

export function writeNativeMediaMuted(element: HTMLMediaElement, muted: boolean): boolean {
	element.muted = muted;
	return element.muted;
}

export function writeNativePlaybackRate(element: HTMLMediaElement, speed: number): number {
	const next = clampControlValue(speed, 'speed', 1);
	// Keep the standard default/current pair coherent when the page has not
	// deliberately separated them. Player UIs commonly project the default while
	// playback itself reads the current rate.
	if (Math.abs(element.defaultPlaybackRate - element.playbackRate) <= 0.005) {
		element.defaultPlaybackRate = next;
	}
	element.playbackRate = next;
	return element.playbackRate;
}

export function writeNativePreservesPitch(element: HTMLMediaElement, preserve: boolean): boolean {
	if (!('preservesPitch' in element)) throw new Error('Pitch preservation is unsupported');
	const target = element as HTMLMediaElement & { preservesPitch: boolean };
	target.preservesPitch = preserve;
	return target.preservesPitch;
}

export function writeNativeLoop(element: HTMLMediaElement, loop: boolean): boolean {
	element.loop = loop;
	return element.loop;
}

async function writeRestorableMediaFieldWithStableAck(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
	desired: ControlValues[SpectraPageMediaField],
	writer: RestorableMediaWriter,
	tolerance: number,
	options: NativeMediaOperationOptions = {},
): Promise<ControlValues[SpectraPageMediaField]> {
	assertNativeOperationCurrent(options);
	const read = (): ControlValues[SpectraPageMediaField] => (
		writer === 'page-native'
			? readRestorableMediaField(element, field, writer)
			: readDomRestorableMediaField(element, field)
	) as ControlValues[SpectraPageMediaField];
	let actual: ControlValues[SpectraPageMediaField];
	if (writer === 'page-native') {
		writeRestorableMediaField(element, field, desired, writer);
		actual = await stablePageReadback(read, options);
	} else {
		actual = await writeWithStableEventAck(
			element,
			field === 'speed' ? 'ratechange' : 'volumechange',
			() => { writeRestorableMediaField(element, field, desired, writer); },
			read,
			desired,
			tolerance,
			750,
			options,
		);
	}
	assertNativeOperationCurrent(options);
	if (!nativeValuesMatch(desired, actual, tolerance)) {
		throw new Error(`${field} readback mismatch after the stable boundary`);
	}
	return actual;
}

async function pageCandidateRestoredBaseline(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
	baseline: ControlValues[SpectraPageMediaField],
	error: unknown,
	tolerance: number,
	options: NativeMediaOperationOptions = {},
): Promise<boolean> {
	// An explicitly unavailable request never called a page setter. Every other
	// page failure may fall through only after the same candidate proves that its
	// baseline is stable again.
	if (error instanceof PageMediaCapabilityUnavailableError) return true;
	try {
		const current = readRestorableMediaField(element, field, 'page-native');
		if (!nativeValuesMatch(current, baseline, tolerance)) {
			writeRestorableMediaField(element, field, baseline, 'page-native');
		}
		const restored = await stablePageReadback(
			() => readRestorableMediaField(element, field, 'page-native'),
			options,
		);
		assertNativeOperationCurrent(options);
		return nativeValuesMatch(restored, baseline, tolerance);
	} catch {
		return false;
	}
}

export class NativeMediaExecutor {
	private readonly pending = new Map<string, Map<ControlField, PendingWrite>>();
	private readonly observed = new Map<string, Partial<ControlValues>>();
	private readonly desiredMedia: ControlPatch = {};
	private readonly appliedDesiredRevision = new Map<string, number>();
	private readonly replayPending = new Set<string>();
	private readonly automaticPageMaturationRevision = new Map<string, number>();
	private readonly pageMaturationRequested = new Map<string, {
		target: MediaTarget;
		element: HTMLMediaElement;
	}>();
	private effects: VideoEffectsControllerPort | null;
	private readonly ownsEffects: boolean;
	private readonly registry: MediaRegistry;
	private readonly unsubscribeRegistry: () => void;
	private audioRuntimeDelegate: AudioRuntimeControlDelegate | null = null;
	private tabId: number | null = null;
	private desiredRevision = 0;
	private disposed = false;
	private readonly lifecycleController = new AbortController();
	private readonly sourceOperationScopes = new Map<string, Set<AbortController>>();

	constructor(registry: MediaRegistry, effects?: VideoEffectsControllerPort) {
		// MediaRegistry is a document-owned singleton.  Constructing a fallback
		// registry here would create an empty second owner with a different source
		// view and silently reintroduce the initial-identity race.
		this.registry = registry;
		this.effects = effects ?? null;
		this.ownsEffects = effects === undefined;
		this.unsubscribeRegistry = this.registry.subscribe(
			(target, event, element, removalReason) =>
				this.handleMediaEvent(target, event, element, removalReason),
		);
		// Establish event-correlation baselines when the runtime is acquired. A
		// later status/read request must remain a pure projection and must not
		// mutate the executor merely to suppress the next native event.
		for (const { target } of this.registry.list()) {
			this.primeObserved(target);
		}
	}

	private async ensureVideoEffects(signal: AbortSignal = this.lifecycleController.signal): Promise<VideoEffectsControllerPort> {
		assertNotAborted(signal);
		if (this.effects) return this.effects;
		const { VideoEffectsController: Controller } = await loadVideoEffectsRuntime();
		assertNotAborted(signal);
		if (this.disposed) throw new ContentLifecycleError('cancelled', 'Native media executor is disposed');
		this.effects = new Controller();
		return this.effects;
	}

	setAudioRuntimeDelegate(delegate: AudioRuntimeControlDelegate | null): void {
		this.audioRuntimeDelegate = delegate;
	}

	private beginSourceOperation(target: MediaTarget): {
		signal: AbortSignal;
		close: () => void;
	} {
		const controller = new AbortController();
		const key = this.targetKey(target);
		const scopes = this.sourceOperationScopes.get(key) ?? new Set<AbortController>();
		scopes.add(controller);
		this.sourceOperationScopes.set(key, scopes);
		// Source cancellation is a child of the document lifecycle. This keeps the
		// operation's single signal sufficient for every bounded ACK/rAF/seek wait;
		// disposing the document cannot leave a source-scoped await behind.
		const onLifecycleAbort = (): void => {
			controller.abort(this.lifecycleController.signal.reason);
		};
		this.lifecycleController.signal.addEventListener('abort', onLifecycleAbort, { once: true });
		if (this.lifecycleController.signal.aborted) onLifecycleAbort();
		return {
			signal: controller.signal,
			close: () => {
				this.lifecycleController.signal.removeEventListener('abort', onLifecycleAbort);
				const current = this.sourceOperationScopes.get(key);
				current?.delete(controller);
				if (current?.size === 0) this.sourceOperationScopes.delete(key);
			},
		};
	}

	private abortSourceOperations(target: MediaTarget): void {
		const scopes = this.sourceOperationScopes.get(this.targetKey(target));
		if (!scopes) return;
		for (const scope of scopes) scope.abort(
			new ContentLifecycleError('stale-media-source', 'Media source was retired'),
		);
		this.sourceOperationScopes.delete(this.targetKey(target));
	}

	private assertCurrentTarget(
		target: MediaTarget,
		element: HTMLMediaElement,
		signal?: AbortSignal,
	): void {
		assertNotAborted(signal);
		if (this.disposed || this.lifecycleController.signal.aborted) {
			throw new ContentLifecycleError('cancelled', 'Native media executor lifecycle has ended');
		}
		const videoResolver = this.registry as MediaRegistry & {
			resolveVideo?(target: MediaTarget | null): ReturnType<MediaRegistry['resolve']>;
		};
		const current = target.kind === 'video' && typeof videoResolver.resolveVideo === 'function'
			? videoResolver.resolveVideo(target)
			: this.registry.resolve(target);
		if (!current || current.element !== element) {
			throw new ContentLifecycleError(
				'stale-media-source',
				'The media target is no longer the registered source identity',
			);
		}
	}

	private isCurrentTarget(target: MediaTarget, element?: HTMLMediaElement): boolean {
		if (this.disposed || this.lifecycleController.signal.aborted) return false;
		const resolver = this.registry as MediaRegistry & {
			resolveVideo?: MediaRegistry['resolveVideo'];
		};
		const current = target.kind === 'video' && typeof resolver.resolveVideo === 'function'
			? resolver.resolveVideo(target)
			: this.registry.resolve(target);
		return !!current && (!element || current.element === element);
	}

	private operationSignal(signal?: AbortSignal): AbortSignal {
		return signal ?? this.lifecycleController.signal;
	}

	bindRequestContext(tabId: number | undefined, documentId: string | undefined): void {
		if (tabId !== undefined) this.tabId = tabId;
		// Document identity is bound when MediaRegistry is constructed.  A request
		// may carry identity for validation, but it must never retag existing media
		// after an asynchronous runtime has already acquired them.
		if (documentId && this.registry.documentId !== documentId) {
			throw new ContentLifecycleError(
				'stale-document',
				'Native request belongs to a different document runtime',
			);
		}
	}

	async execute(intent: ControlIntent): Promise<ControlApplyAck> {
		if (this.disposed) throw new Error('Native media executor is disposed');
		this.tabId = intent.tabId;
		const fields: ControlFieldStates = {};
		const runtimePatch: ControlPatch = {};
		const directEntries: Array<[ControlField, ControlValues[ControlField]]> = [];
		this.audioRuntimeDelegate?.synchronizeNative(intent.actualContext);
		for (const [rawField, rawValue] of Object.entries(intent.patch)) {
			const field = rawField as ControlField;
			const value = rawValue as ControlValues[ControlField];
			if (AUDIO_RUNTIME_FIELDS.has(field)) {
				(runtimePatch as Record<string, unknown>)[field] = value;
			} else {
				directEntries.push([field, value]);
			}
		}
		const onlyVideoFields = directEntries.length > 0
			&& directEntries.every(([field]) => VIDEO_EFFECT_FIELDS.has(field)
				|| field === 'pip'
				|| field === 'fullscreen');
		const videoResolver = this.registry as MediaRegistry & {
			resolveVideo?(target: import('@nexus/contracts').MediaTarget | null): ReturnType<MediaRegistry['resolve']>;
		};
		const resolved = onlyVideoFields && typeof videoResolver.resolveVideo === 'function'
			? videoResolver.resolveVideo(intent.target)
			: this.registry.resolve(intent.target);
		const sourceScope = resolved ? this.beginSourceOperation(resolved.target) : null;
		const operationSignal = this.operationSignal(sourceScope?.signal);
		try {
		if (intent.source === 'restore') {
			for (const [field, value] of directEntries) {
				if (isRestorableMediaField(field)) this.rememberDesired(field, value);
			}
		}
		for (const [field, value] of directEntries) {
			await this.applyField(intent, resolved, field, value, fields, operationSignal);
			const state = fields[field];
			if (isRestorableMediaField(field)
				&& state?.phase === 'applied'
				&& state.desired !== null) {
				this.rememberDesired(field, state.desired);
			}
		}
		this.synchronizeAppliedNative(fields);
		if (Object.keys(runtimePatch).length > 0) {
			if (this.audioRuntimeDelegate) {
				Object.assign(fields, await this.audioRuntimeDelegate.apply(intent, runtimePatch));
				if (resolved) this.assertCurrentTarget(resolved.target, resolved.element, operationSignal);
			} else {
				for (const [rawField, rawValue] of Object.entries(runtimePatch)) {
					this.putError(
						fields,
						rawField as ControlField,
						rawValue as ControlValues[ControlField],
						intent,
						'strategy-runtime-failed',
						'The acknowledged audio runtime is unavailable',
					);
				}
			}
		}
		if (resolved && directEntries.some(([field]) => RESTORABLE_MEDIA_FIELDS.has(field))) {
			const restored = directEntries
				.filter(([field]) => RESTORABLE_MEDIA_FIELDS.has(field))
				.every(([field]) => fields[field]?.phase === 'applied');
			if (restored) this.appliedDesiredRevision.set(this.targetKey(resolved.target), this.desiredRevision);
		}
		if (resolved) this.assertCurrentTarget(resolved.target, resolved.element, operationSignal);
		// Feedback is a physical readback, not a mutation of unrelated snapshot
		// fields. A cold mute still needs actual base volume and processor state.
		let audioVolume: ControlApplyAck['audioVolume'];
		if (resolved && this.audioRuntimeDelegate?.readAudioVolume
			&& (fields.mediaMuted?.phase === 'applied' || fields.volumeBase?.phase === 'applied')) {
			try {
				const { patch } = this.read({ fields: ['volumeBase', 'mediaMuted'], target: resolved.target });
				if (typeof patch.volumeBase === 'number' && typeof patch.mediaMuted === 'boolean') {
					audioVolume = this.audioRuntimeDelegate.readAudioVolume(patch.volumeBase, patch.mediaMuted);
				}
			} catch (error) {
				// Preserve the applied mutation, but report the unavailable feedback sample.
				console.warn('[SPECTRA] Audio feedback readback unavailable', error);
			}
		}
		return {
			...(audioVolume ? { audioVolume } : {}),
			intentId: intent.intentId,
			tabId: intent.tabId,
			documentId: intent.documentId,
			generation: intent.generation,
			revision: intent.baseRevision + 1,
			// ACK the target that was actually resolved for this document. Echoing a
			// requested-but-stale target would let Background publish a false owner.
			target: resolved?.target ?? null,
			fields,
		};
		} finally {
			sourceScope?.close();
		}
	}

	async toggleTrustedActivation(
		field: 'playing' | 'pip' | 'fullscreen',
		explicitTarget?: MediaTarget,
	): Promise<{
		target: import('@nexus/contracts').MediaTarget;
		actual: boolean;
	}> {
		if (this.disposed) throw new Error('Native media executor is disposed');
		if (field === 'pip' && explicitTarget && document.pictureInPictureElement) {
			const requested = this.registry.resolveVideo(explicitTarget);
			if (!requested) throw new Error('No active video target');
			const owner = document.pictureInPictureElement;
			const registeredOwner = resolvePictureInPictureOwner(this.registry);
			const acknowledgementTarget = owner instanceof EventTarget
				? owner
				: requested.element;
			const sourceScope = this.beginSourceOperation(requested.target);
			try {
				const actual = await writeWithStableEventAck(
					acknowledgementTarget,
					'leavepictureinpicture',
					() => document.exitPictureInPicture(),
					() => document.pictureInPictureElement !== null,
					false,
					0,
					750,
					{ signal: sourceScope.signal, isCurrent: () => this.isCurrentTarget(requested.target, requested.element) },
				);
				this.assertCurrentTarget(requested.target, requested.element, sourceScope.signal);
				return {
					target: registeredOwner?.target ?? requested.target,
					actual,
				};
			} finally {
				sourceScope.close();
			}
		}
		const resolved = field === 'pip' && explicitTarget
			? this.registry.resolveVideo(explicitTarget)
			: field === 'playing'
				? this.registry.resolve(null)
				: field === 'pip'
					? resolvePictureInPictureOwner(this.registry) ?? this.registry.resolveVideo(null)
					: this.registry.resolveVideo(null);
		if (!resolved) throw new Error(field === 'playing' ? 'No active media target' : 'No active video target');
		const { element, target } = resolved;
		const current = field === 'playing'
			? !element.paused
			: field === 'pip'
				? document.pictureInPictureElement === element
				: fullscreenOwnsMedia(element);
		const intent: ControlIntent = {
			intentId: `trusted-hotkey-${field}-${performance.now().toString(36)}`,
			tabId: this.tabId ?? 1,
			documentId: target.documentId,
			generation: 0,
			baseRevision: 0,
			source: 'hotkey',
			requestedCoverage: 'active-target',
			target,
			actualContext: {},
			patch: { [field]: !current },
		};
		const fields: ControlFieldStates = {};
		const sourceScope = this.beginSourceOperation(target);
		try {
			await this.applyField(intent, resolved, field, !current, fields, sourceScope.signal);
			this.assertCurrentTarget(target, element, sourceScope.signal);
		const state = fields[field];
		if (state?.phase !== 'applied' || typeof state.actual !== 'boolean') {
			throw new Error(state?.lastError?.message ?? `Native ${field} toggle was not applied`);
		}
		return { target, actual: state.actual };
		} finally {
			sourceScope.close();
		}
	}

	async stepFrame(
		intent: ControlOperationIntent<'frame-step'>,
	): Promise<{ result: ControlFrameStepResult; fields: ControlFieldStates }> {
		const resolved = this.registry.resolveVideo(intent.target);
		if (!resolved || !(resolved.element instanceof HTMLVideoElement)) {
			throw new Error('No active video target');
		}
		const video = resolved.element;
		const sourceScope = this.beginSourceOperation(resolved.target);
		try {
			const options: NativeMediaOperationOptions = {
				signal: this.operationSignal(sourceScope.signal),
				isCurrent: () => this.isCurrentTarget(resolved.target, video),
			};
			const frameDuration = await measureVideoFrameDuration(
				video,
				resolved.target.sourceRevision,
				options,
			);
			this.assertCurrentTarget(resolved.target, video, options.signal);
			const currentTime = await seekNativeMedia(
				video,
				video.currentTime + intent.payload.direction * frameDuration,
				frameDuration / 2,
				options,
			);
			this.assertCurrentTarget(resolved.target, video, options.signal);
		const pseudoIntent: ControlIntent = {
			intentId: intent.operationId,
			tabId: intent.tabId,
			documentId: intent.documentId,
			generation: intent.generation,
			baseRevision: intent.baseRevision,
			source: intent.source,
			requestedCoverage: 'active-target',
			target: resolved.target,
			actualContext: {},
			patch: { currentTime },
		};
		const fields: ControlFieldStates = {};
		this.putState(fields, 'currentTime', currentTime, currentTime, pseudoIntent, 'dom-native');
		return {
			result: { currentTime, frameDuration, approximate: true },
			fields,
		};
		} finally {
			sourceScope.close();
		}
	}

	readMediaSummary(target: import('@nexus/contracts').MediaTarget | null): {
		playing: boolean;
		speed: number;
		currentTime: number;
	} {
		return this.read({ target, fields: ['playing', 'speed', 'currentTime'] }).patch as {
			playing: boolean;
			speed: number;
			currentTime: number;
		};
	}

	async releasePageSettings(
		intent: ControlOperationIntent<'restore-page-settings'>,
	): Promise<{ releasedFields: ControlField[]; fields: ControlFieldStates }> {
		const active = this.registry.resolve(intent.target);
		const activeKey = active ? this.targetKey(active.target) : null;
		const fields: ControlFieldStates = {};
		const released = new Set<ControlField>();
		for (const { element, target } of this.registry.list()) {
			this.assertCurrentTarget(target, element);
			const key = this.targetKey(target);
			const ownership = nativeMediaOwnership.byElement.get(element);
			if (ownership) {
				for (const [field, owned] of [...ownership.entries()]) {
					const tolerance = field === 'volumeBase' || field === 'speed' ? 0.01 : 0;
					const current = readRestorableMediaField(element, field, owned.writer);
					if (!nativeValuesMatch(current, owned.lastApplied, tolerance)) {
						// The page/user changed the field after SPECTRA's last ACK. It is no
						// longer our property to restore.
						ownership.delete(field);
						continue;
					}
					writeRestorableMediaField(element, field, owned.baseline, owned.writer);
					const actual = await (owned.writer === 'page-native' ? stablePageReadback : stableReadback)(
						() => readRestorableMediaField(element, field, owned.writer),
						{
							signal: this.lifecycleController.signal,
							isCurrent: () => this.isCurrentTarget(target, element),
						},
					);
					this.assertCurrentTarget(target, element);
					if (!nativeValuesMatch(actual, owned.baseline, tolerance)) {
						throw new Error(`Page baseline readback failed for ${field}`);
					}
					ownership.delete(field);
					released.add(field);
					if (key === activeKey) {
						(fields as Record<string, unknown>)[field] = {
							desired: null,
							actual: actual as ControlValues[ControlField],
							revision: intent.baseRevision + 1,
							phase: 'applied',
							strategy: owned.writer,
							coverage: 'active-target',
							controlled: false,
							intentId: intent.operationId,
							lastError: null,
						};
					}
				}
				if (ownership.size === 0) nativeMediaOwnership.byElement.delete(element);
			}
			this.appliedDesiredRevision.delete(key);
			if (element instanceof HTMLVideoElement) {
				const releasedState = this.effects?.release(element) ?? DEFAULT_VIDEO_EFFECT_STATE;
				for (const field of VIDEO_EFFECT_FIELDS) released.add(field);
				if (key === activeKey) {
					for (const field of VIDEO_EFFECT_FIELDS) {
						(fields as Record<string, unknown>)[field] = {
							desired: null,
							actual: releasedState[field as keyof typeof releasedState],
							revision: intent.baseRevision + 1,
							phase: 'applied',
							strategy: field === 'dimEnabled' || field === 'dimOpacity'
								? 'extension-overlay'
								: 'extension-css',
							coverage: 'active-target',
							controlled: false,
							intentId: intent.operationId,
							lastError: null,
						};
					}
				}
			}
		}
		for (const key of Object.keys(this.desiredMedia)) delete (this.desiredMedia as Record<string, unknown>)[key];
		this.desiredRevision += 1;
		this.automaticPageMaturationRevision.clear();
		this.pageMaturationRequested.clear();
		return { releasedFields: [...released], fields };
	}

	read(request: ControlReadRequest): ControlReadResult {
		if (this.disposed) throw new Error('Native media executor is disposed');
		const patch: ControlPatch = {};
		const observedStrategies: ControlNativeObservationStrategies = {};
		const runtimeFields = request.fields.filter((field) => AUDIO_RUNTIME_FIELDS.has(field));
		if (runtimeFields.length > 0 && this.audioRuntimeDelegate) {
			Object.assign(patch, this.audioRuntimeDelegate.read(runtimeFields));
		}
		const onlyVideoFields = request.fields.length > 0
			&& request.fields.every((field) => VIDEO_EFFECT_FIELDS.has(field)
				|| field === 'pip'
				|| field === 'fullscreen');
		const videoResolver = this.registry as MediaRegistry & {
			resolveVideo?(target: import('@nexus/contracts').MediaTarget | null): ReturnType<MediaRegistry['resolve']>;
		};
		const pipOwner = request.target === null && request.fields.includes('pip')
			? resolvePictureInPictureOwner(this.registry)
			: null;
		const resolved = pipOwner
			?? (onlyVideoFields && typeof videoResolver.resolveVideo === 'function'
				? videoResolver.resolveVideo(request.target)
				: this.registry.resolve(request.target));
		if (resolved) {
			const { element, target } = resolved;
			const effectState = request.fields.some((field) => VIDEO_EFFECT_FIELDS.has(field))
				&& element instanceof HTMLVideoElement
				? this.effects?.snapshot(element) ?? DEFAULT_VIDEO_EFFECT_STATE
				: null;
			for (const field of request.fields) {
				if ((patch as Record<string, unknown>)[field] !== undefined) continue;
				let actual: unknown;
				switch (field) {
					case 'volumeBase':
					case 'mediaMuted':
					case 'speed': {
						const observed = readRestorableMediaFieldWithWriter(element, field);
						actual = observed.actual;
						observedStrategies[field] = observed.writer;
						break;
					}
					case 'preservePitch':
						if ('preservesPitch' in element) {
							actual = (element as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch;
							observedStrategies.preservePitch = 'dom-native';
						}
						break;
					case 'playing': actual = !element.paused; observedStrategies.playing = 'dom-native'; break;
					case 'currentTime': actual = element.currentTime; observedStrategies.currentTime = 'dom-native'; break;
					case 'loop': actual = element.loop; observedStrategies.loop = 'dom-native'; break;
					case 'pip': actual = document.pictureInPictureElement === element; observedStrategies.pip = 'dom-native'; break;
					case 'fullscreen': actual = fullscreenOwnsMedia(element); observedStrategies.fullscreen = 'dom-native'; break;
					case 'rotation': actual = effectState?.rotation; break;
					case 'mirrored': actual = effectState?.mirrored; break;
					case 'fill': actual = effectState?.fill; break;
					case 'filterEnabled': actual = effectState?.filterEnabled; break;
					case 'filter': actual = effectState?.filter; break;
					case 'dimEnabled': actual = effectState?.dimEnabled; break;
					case 'dimOpacity': actual = effectState?.dimOpacity; break;
				}
				if (actual !== undefined) (patch as Record<string, unknown>)[field] = actual;
			}
			if (Object.keys(patch).length > 0) return { target, patch, observedStrategies };
		}
		if (Object.keys(patch).length === 0) {
			throw new Error('No requested control field has an observable actual value');
		}
		return { target: request.target, patch, observedStrategies };
	}

	private async applyField(
		intent: ControlIntent,
		resolved: ReturnType<MediaRegistry['resolve']>,
		field: ControlField,
		value: ControlValues[ControlField],
		fields: ControlFieldStates,
		signal: AbortSignal = this.lifecycleController.signal,
	): Promise<void> {
		if (!resolved) {
			this.putError(fields, field, value, intent, 'capability-unavailable', 'No active media target');
			return;
		}
		const { element, target } = resolved;
		const isCurrent = (): boolean => this.isCurrentTarget(target, element);
		const assertCurrent = (waitSignal = signal): void => this.assertCurrentTarget(target, element, waitSignal);
		assertCurrent();
		this.primeObserved(target);
		if (VIDEO_EFFECT_FIELDS.has(field)) {
			if (!(element instanceof HTMLVideoElement)) {
				this.putError(fields, field, value, intent, 'capability-unavailable', 'The active target is audio-only');
				return;
			}
			const strategy = contentControlStrategy(field, intent.requestedCoverage);
			if (strategy !== 'extension-css' && strategy !== 'extension-overlay') {
				this.putError(fields, field, value, intent, 'capability-unavailable', 'No admitted video enhancement is available');
				return;
			}
			const effects = await this.ensureVideoEffects(signal);
			assertCurrent();
			const applyEffects = effects.apply as unknown as (
				video: HTMLVideoElement,
				field: 'rotation' | 'mirrored' | 'fill' | 'filterEnabled' | 'filter' | 'dimEnabled' | 'dimOpacity',
				value: unknown,
				options?: VideoEffectApplyOptions,
			) => Promise<unknown>;
			const actual = await applyEffects(
				element,
				field as 'rotation' | 'mirrored' | 'fill' | 'filterEnabled' | 'filter' | 'dimEnabled' | 'dimOpacity',
				value as never,
				{
					signal,
					deadlineMs: 250,
					isCurrent,
				},
			) as ControlValues[ControlField];
			assertCurrent();
			this.putState(fields, field, value, actual, intent, strategy);
			return;
		}

		const strategy = contentControlStrategy(field, intent.requestedCoverage);
		if (strategy !== 'dom-native') {
			this.putError(fields, field, value, intent, 'capability-unavailable', 'No complete standard media strategy is available');
			return;
		}

		const tolerance = field === 'volumeBase' || field === 'speed'
			? 0.01
			: field === 'currentTime' ? 0.05 : 0;
		const effectiveDesired = field === 'currentTime'
			? clampNativeSeek(element, value as number)
			: value;
		let baseline: ControlValues[RestorableMediaField] | undefined;
		let mediaWriter: RestorableMediaWriter = 'dom-native';
		let writerUpgrade: OwnedMediaField | undefined;
		if (isRestorableMediaField(field)) {
			try {
				const baselineState = readRestorableMediaFieldForWrite(element, field);
				baseline = baselineState.actual;
				mediaWriter = baselineState.writer;
				writerUpgrade = baselineState.upgradeFrom;
			} catch (error) {
				const failure = this.nativeFailure(field, error);
				this.putError(
					fields,
					field,
					effectiveDesired,
					intent,
					failure.code,
					failure.message,
					failure.retryable,
				);
				return;
			}
		}
		this.markPending(target.mediaId, field, {
			intentId: intent.intentId,
			revision: intent.baseRevision + 1,
			expected: effectiveDesired,
			tolerance,
			timeoutId: setTimeout(() => this.clearPending(target.mediaId, field, intent.intentId), 1_000),
		});
		try {
			if (field === 'volumeBase' || field === 'mediaMuted' || field === 'speed') {
				if (baseline === undefined) throw new Error(`Missing ${field} baseline`);
				// A standard element's volume physically clamps to the 0-100 scale, so
				// a DOM-writer request above 100 can only end in the 750ms event-ack
				// timeout. Reject it here — one cheap capability read has already
				// happened — so the coordinator's amplified-volume probe fails in
				// milliseconds and every routing-boundary crossing stays smooth.
				if (field === 'volumeBase'
					&& mediaWriter === 'dom-native'
					&& (effectiveDesired as number) > CONTROL_VALUE_LIMITS.volumeBase.max) {
					this.putError(
						fields,
						field,
						effectiveDesired,
						intent,
						'capability-unavailable',
						'Standard media volume cannot honor an above-100 scale',
					);
					return;
				}
				const pageWriterAlreadyOwned = nativeMediaOwnership.byElement.get(element)?.get(field)?.writer
					=== 'page-native';
				let actual: ControlValues[typeof field];
				try {
					actual = await writeRestorableMediaFieldWithStableAck(
						element,
						field,
						effectiveDesired as ControlValues[typeof field],
						mediaWriter,
						tolerance,
						{ signal, isCurrent },
					) as ControlValues[typeof field];
					assertCurrent();
				} catch (pageError) {
					assertCurrent();
					// The DOM writer physically clamps volumeBase to the standard
					// 0-100 scale, so an above-100 probe can never be honored there.
					// Skipping the DOM attempt keeps the coordinator's rejected probe
					// on one fast page-bridge readback instead of a guaranteed 750ms
					// event-ack timeout on every routing-boundary crossing.
					const domCannotScale = field === 'volumeBase'
						&& (effectiveDesired as number) > CONTROL_VALUE_LIMITS.volumeBase.max;
					const mayFallThrough = !domCannotScale
						&& mediaWriter === 'page-native'
						&& !pageWriterAlreadyOwned
						&& await pageCandidateRestoredBaseline(
							element,
							field,
							baseline as ControlValues[typeof field],
							pageError,
							tolerance,
							{ signal, isCurrent },
						);
					assertCurrent();
					if (!mayFallThrough) throw pageError;
					if (writerUpgrade) {
						await writeRestorableMediaFieldWithStableAck(
							element,
							field,
							writerUpgrade.lastApplied as ControlValues[typeof field],
							'dom-native',
							tolerance,
							{ signal, isCurrent },
						);
						assertCurrent();
						baseline = writerUpgrade.lastApplied;
						writerUpgrade = undefined;
					} else {
						baseline = readDomRestorableMediaField(element, field);
					}
					mediaWriter = 'dom-native';
					actual = await writeRestorableMediaFieldWithStableAck(
						element,
						field,
						effectiveDesired as ControlValues[typeof field],
						mediaWriter,
						tolerance,
						{ signal, isCurrent },
					) as ControlValues[typeof field];
					assertCurrent();
				}
				this.putState(fields, field, effectiveDesired, actual, intent, mediaWriter);
				this.observe(target.mediaId, field, actual);
			} else switch (field) {
				case 'preservePitch': {
					writeNativePreservesPitch(element, value as boolean);
					const actual = await stableReadback(() => (
						element as HTMLMediaElement & { preservesPitch: boolean }
					).preservesPitch, {
						signal,
						isCurrent,
					});
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Pitch-preservation readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				case 'playing': {
					const actual = await writeWithStableEventAck(
						element,
						value ? 'playing' : 'pause',
						() => value ? element.play() : element.pause(),
						() => !element.paused,
						 effectiveDesired,
						tolerance,
						750,
						{ signal, isCurrent },
					);
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Playback readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				case 'currentTime': {
					await seekNativeMedia(element, effectiveDesired as number, tolerance, {
						signal,
						isCurrent,
					});
					assertCurrent();
					const actual = await stableReadback(() => element.currentTime, {
						signal,
						isCurrent,
					});
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Seek readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				case 'loop': {
					writeNativeLoop(element, value as boolean);
					const actual = await stableReadback(() => element.loop, {
						signal,
						isCurrent,
					});
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Loop readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				case 'pip': {
					if (!(element instanceof HTMLVideoElement) || !document.pictureInPictureEnabled) {
						throw new Error('Picture-in-Picture is unsupported');
					}
					const actual = await writeWithStableEventAck(
						element,
						value ? 'enterpictureinpicture' : 'leavepictureinpicture',
						async () => {
							if (value) {
								if (document.pictureInPictureElement
									&& document.pictureInPictureElement !== element) {
									await document.exitPictureInPicture();
								}
								// Sites may set disablePictureInPicture as a UI preference. The
								// explicit extension click temporarily lifts it for this native call.
								const restoreDisabled = element.disablePictureInPicture;
								if (restoreDisabled) element.disablePictureInPicture = false;
								try {
									await element.requestPictureInPicture();
								} finally {
									if (restoreDisabled) element.disablePictureInPicture = true;
								}
							}
							else if (document.pictureInPictureElement === element) await document.exitPictureInPicture();
						},
						() => document.pictureInPictureElement === element,
						effectiveDesired,
						tolerance,
						750,
						{ signal, isCurrent },
					);
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Picture-in-Picture readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				case 'fullscreen': {
					const requestFullscreen = async (): Promise<void> => {
						if (value) await element.requestFullscreen();
						else if (fullscreenOwnsMedia(element)) await document.exitFullscreen();
					};
					const actual = await writeWithStableEventAck(
						document,
						'fullscreenchange',
						() => value && this.audioRuntimeDelegate?.runFullscreenTransition
							? this.audioRuntimeDelegate.runFullscreenTransition(requestFullscreen)
							: requestFullscreen(),
						() => fullscreenOwnsMedia(element),
						effectiveDesired,
						tolerance,
						750,
						{ signal, isCurrent },
					);
					assertCurrent();
					if (!nativeValuesMatch(effectiveDesired, actual, tolerance)) {
						throw new Error('Fullscreen readback mismatch after the stable boundary');
					}
					this.putState(fields, field, effectiveDesired, actual, intent, 'dom-native');
					this.observe(target.mediaId, field, actual);
					break;
				}
				default:
					this.putError(
						fields,
						field,
						value,
						intent,
						'capability-unavailable',
						'No safe native or augmentation strategy is available',
					);
			}
			const state = fields[field];
			if (isRestorableMediaField(field)
				&& baseline !== undefined
				&& state?.phase === 'applied'
				&& state.actual !== null) {
				this.commitOwnership(
					element,
					field,
					baseline,
					state.actual,
					mediaWriter,
					writerUpgrade,
				);
			}
		} catch (error) {
			if (isContentLifecycleError(error)) throw error;
			try {
				assertCurrent();
			} catch (lifecycleError) {
				if (isContentLifecycleError(lifecycleError)) throw lifecycleError;
			}
			if (isRestorableMediaField(field) && baseline !== undefined) {
				await this.rollbackFailedRestorableWrite(
					element,
					field,
					baseline,
					effectiveDesired,
					mediaWriter,
					signal,
				)
					.catch(() => undefined);
			}
			const failure = this.nativeFailure(field, error);
			this.putError(
				fields,
				field,
				effectiveDesired,
				intent,
				failure.code,
				failure.message,
				failure.retryable,
				baseline,
			);
		} finally {
			this.clearPending(target.mediaId, field, intent.intentId);
		}
	}

	private commitOwnership(
		element: HTMLMediaElement,
		field: RestorableMediaField,
		baseline: ControlValues[RestorableMediaField],
		actual: ControlValues[ControlField],
		writer: RestorableMediaWriter,
		upgradeFrom?: OwnedMediaField,
	): void {
		const fields = nativeMediaOwnership.byElement.get(element)
			?? new Map<RestorableMediaField, OwnedMediaField>();
		const previous = fields.get(field);
		if (upgradeFrom && previous !== upgradeFrom) {
			throw new Error(`Restorable ${field} ownership changed during writer upgrade`);
		}
		if (previous && previous.writer !== writer) {
			const validUpgrade = previous === upgradeFrom
				&& previous.writer === 'dom-native'
				&& writer === 'page-native';
			if (!validUpgrade) {
				throw new Error(`Restorable ${field} writer changed while ownership was active`);
			}
		}
		fields.set(field, {
			baseline: previous?.baseline ?? baseline,
			lastApplied: actual as ControlValues[RestorableMediaField],
			writer,
		});
		nativeMediaOwnership.byElement.set(element, fields);
	}

	private async rollbackFailedRestorableWrite(
		element: HTMLMediaElement,
		field: RestorableMediaField,
		baseline: ControlValues[RestorableMediaField],
		attempted: ControlValues[ControlField],
		writer: RestorableMediaWriter,
		signal?: AbortSignal,
	): Promise<void> {
		assertNativeOperationCurrent({ signal });
		const tolerance = field === 'volumeBase' || field === 'speed' ? 0.01 : 0;
		const current = readRestorableMediaField(element, field, writer);
		if (!nativeValuesMatch(current, attempted, tolerance)) return;
		writeRestorableMediaField(element, field, baseline, writer);
		await (writer === 'page-native' ? stablePageReadback : stableReadback)(
			() => readRestorableMediaField(element, field, writer),
			{ signal },
		);
	}

	private putState(
		fields: ControlFieldStates,
		field: ControlField,
		desired: ControlValues[ControlField],
		actual: ControlValues[ControlField],
		intent: ControlIntent,
		strategy: ControlStrategy,
	): void {
		(fields as Record<string, unknown>)[field] = {
			desired,
			actual,
			revision: intent.baseRevision + 1,
			phase: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01) ? 'applied' : 'error',
			strategy,
			coverage: 'active-target',
			controlled: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01),
			intentId: intent.intentId,
			lastError: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01)
				? null
				: { code: 'readback-mismatch', message: 'Actual state differs from the requested value', retryable: true },
		};
	}

	private synchronizeAppliedNative(fields: ControlFieldStates): void {
		if (!this.audioRuntimeDelegate) return;
		const context: ControlActualContext = {};
		for (const field of ['volumeBase', 'mediaMuted', 'speed', 'preservePitch'] as const) {
			const state = fields[field];
			if (state?.phase === 'applied' && state.actual !== null) {
				(context as Record<string, unknown>)[field] = state.actual;
			}
		}
		this.audioRuntimeDelegate.synchronizeNative(context);
	}

	private putError(
		fields: ControlFieldStates,
		field: ControlField,
		desired: ControlValues[ControlField],
		intent: ControlIntent,
		code: ControlStrategyFailure,
		message: string,
		retryable = true,
		restoreBaseline?: ControlValues[RestorableMediaField],
	): void {
		(fields as Record<string, unknown>)[field] = {
			desired,
			actual: null,
			...(restoreBaseline === undefined ? {} : { restoreBaseline }),
			revision: intent.baseRevision + 1,
			phase: 'error',
			strategy: 'unsupported',
			coverage: 'partial',
			controlled: false,
			intentId: intent.intentId,
			lastError: { code, message, retryable },
		};
	}

	private nativeFailure(
		field: ControlField,
		error: unknown,
	): { code: ControlStrategyFailure; message: string; retryable: boolean } {
		const message = error instanceof Error ? error.message : String(error);
		const name = error && typeof error === 'object' && 'name' in error
			? String((error as { name: unknown }).name)
			: '';
		if (message.toLowerCase().includes('readback')) {
			return { code: 'readback-mismatch', message, retryable: true };
		}
		if ((message.includes('unsupported') || name === 'NotSupportedError')
			&& (field === 'volumeBase' || field === 'mediaMuted' || field === 'speed')) {
			return { code: 'write-unsupported', message, retryable: true };
		}
		if (message.includes('unsupported') || name === 'NotSupportedError') {
			return { code: 'capability-unavailable', message, retryable: true };
		}
		if (name === 'NotAllowedError'
			|| ((field === 'playing' || field === 'pip' || field === 'fullscreen')
				&& name === 'TypeError')) {
			return { code: 'user-activation-required', message, retryable: false };
		}
		if (name === 'SecurityError') {
			return { code: 'policy-denied', message, retryable: false };
		}
		return { code: 'strategy-runtime-failed', message, retryable: true };
	}

	private markPending(mediaId: string, field: ControlField, pending: PendingWrite): void {
		let fields = this.pending.get(mediaId);
		if (!fields) {
			fields = new Map();
			this.pending.set(mediaId, fields);
		}
		const previous = fields.get(field);
		if (previous) clearTimeout(previous.timeoutId);
		fields.set(field, pending);
	}

	private clearPending(mediaId: string, field: ControlField, intentId: string): void {
		const fields = this.pending.get(mediaId);
		const pending = fields?.get(field);
		if (pending?.intentId === intentId) {
			clearTimeout(pending.timeoutId);
			fields?.delete(field);
		}
		if (fields?.size === 0) this.pending.delete(mediaId);
	}

	private handleMediaEvent(
		target: import('@nexus/contracts').MediaTarget,
		event: MediaRegistryEvent,
		element: HTMLMediaElement,
		removalReason?: MediaRegistryRemovalReason,
	): void {
		if (event === 'removed') {
			// Source retirement is the cancellation boundary.  It applies equally to
			// DOM detach and SPA source reuse; the element object alone is not an
			// ownership identity.
			this.abortSourceOperations(target);
			if (this.disposed || this.tabId === null) return;
			const key = this.targetKey(target);
			const pending = this.pending.get(target.mediaId);
			if (pending) {
				for (const write of pending.values()) clearTimeout(write.timeoutId);
				this.pending.delete(target.mediaId);
			}
			this.observed.delete(target.mediaId);
			this.appliedDesiredRevision.delete(key);
			this.replayPending.delete(key);
			this.pageMaturationRequested.delete(key);
			for (const attemptKey of this.automaticPageMaturationRevision.keys()) {
				if (attemptKey.startsWith(`${key}:`)) {
					this.automaticPageMaturationRevision.delete(attemptKey);
				}
			}
			if (removalReason === 'detached') {
				void this.releaseDetachedOwnership(element);
			} else {
				// A reused element already points at the new resource when the
				// mutation reaches us. Restoring the old baseline would therefore
				// write stale values into the new source; discard the old source's
				// native ownership synchronously instead.
				nativeMediaOwnership.byElement.delete(element);
			}
			clearNativeMediaAsyncState(element);
			if (element instanceof HTMLVideoElement) {
				if (removalReason === 'source-change') this.effects?.retireSource?.(element);
				else this.effects?.release(element);
			}
			return;
		}
		if (this.disposed || this.tabId === null) return;
		if (event === 'selected') {
			this.primeObserved(target);
			this.replayDesired(target, element, true);
			void sendSpectraRequest(
				'spectra.content.target.changed',
				{ target },
				{ documentId: target.documentId },
			).catch(() => undefined);
			return;
		}
		if (event === 'registered') this.primeObserved(target);
		if (event === 'registered') this.replayDesired(target);
		else if (event === 'loadedmetadata' || event === 'play') {
			this.replayDesired(target, element, true);
		}
		const resolved = this.registry.resolve(null);
		if (!resolved || resolved.target.mediaId !== target.mediaId) return;
		const mediaId = target.mediaId;
		let observedFields: ControlReadRequest['fields'];
		if (event === 'volumechange') {
			observedFields = ['volumeBase', 'mediaMuted'];
		} else if (event === 'ratechange') {
			// preservesPitch has no native event; observe it in the rate transaction.
			observedFields = ['speed', 'preservePitch'];
		} else if (event === 'play' || event === 'pause') {
			observedFields = ['playing'];
		} else if (event === 'seeked') {
			observedFields = ['currentTime'];
		} else if (event === 'loopchange') {
			observedFields = ['loop'];
		} else if (event === 'enterpictureinpicture' || event === 'leavepictureinpicture') {
			observedFields = ['pip'];
		} else if (event === 'fullscreenchange') {
			observedFields = ['fullscreen'];
		} else return;
		const { patch: candidates, observedStrategies: candidateStrategies } = this.read({
			target, fields: observedFields,
		});

		const pending = this.pending.get(mediaId);
		const ownedSeek = event === 'seeked'
			&& consumeOwnedSeek(element, element.currentTime);
		const observed = this.observed.get(mediaId) ?? {};
		const patch: ControlPatch = {};
		const observedStrategies: ControlNativeObservationStrategies = {};
		for (const [rawField, actual] of Object.entries(candidates)) {
			const field = rawField as ControlField;
			const write = pending?.get(field);
			if (write) {
				if (nativeValuesMatch(write.expected, actual, write.tolerance)) {
					this.observe(mediaId, field, actual as ControlValues[ControlField]);
				}
				// The executor's event/getter transaction owns every event for this
				// field until its stable boundary settles. A transient mismatch is
				// evidence for that transaction, not a competing page revision.
				continue;
			}
			if (field === 'currentTime' && ownedSeek) {
				this.observe(mediaId, field, actual as ControlValues[ControlField]);
				continue;
			}
			if (nativeValuesMatch(observed[field], actual, field === 'currentTime' ? 0.05 : 0.01)) continue;
			this.observe(mediaId, field, actual as ControlValues[ControlField]);
			(patch as Record<string, unknown>)[field] = actual;
			const strategy = candidateStrategies[field as keyof ControlNativeObservationStrategies];
			if (!strategy) throw new Error(`Native observation strategy is missing for ${field}`);
			observedStrategies[field as keyof ControlNativeObservationStrategies] = strategy;
		}
		if (event === 'volumechange' && Object.keys(patch).length > 0) {
			// Page volume and page mute are one semantic transaction even when only
			// one value changed. Publishing the coherent pair prevents Popup state
			// from combining a fresh slider value with stale mute state.
			patch.volumeBase = candidates.volumeBase;
			patch.mediaMuted = candidates.mediaMuted;
			observedStrategies.volumeBase = candidateStrategies.volumeBase;
			observedStrategies.mediaMuted = candidateStrategies.mediaMuted;
			this.observe(mediaId, 'volumeBase', candidates.volumeBase as number);
			this.observe(mediaId, 'mediaMuted', candidates.mediaMuted as boolean);
			if (candidateStrategies.volumeBase === 'page-native') {
				// A controller that mounted after page entry upgrades the hostname's
				// solidified volume-scale verdict.
				void sendSpectraRequest('spectra.audio.page-scale.record', {
					supported: true,
				}).catch(() => undefined);
			}
		}
		if (Object.keys(patch).length === 0) return;
		this.audioRuntimeDelegate?.synchronizeNative(patch);
		for (const rawField of Object.keys(patch)) {
			const field = rawField as ControlField;
			if (isRestorableMediaField(field)) {
				const ownership = nativeMediaOwnership.byElement.get(element);
				ownership?.delete(field);
				if (ownership?.size === 0) nativeMediaOwnership.byElement.delete(element);
				// Page observations are per media/source actual state. They never become
				// a document-wide desired template replayed onto later media elements.
			}
		}
		void sendSpectraRequest('spectra.control.intent.submit', {
			tabId: this.tabId,
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch,
			observedStrategies,
		}).catch(() => undefined);
	}

	private rememberDesired(field: ControlField, value: ControlValues[ControlField]): void {
		if (nativeValuesMatch((this.desiredMedia as Record<string, unknown>)[field], value, 0.001)) return;
		(this.desiredMedia as Record<string, unknown>)[field] = value;
		this.desiredRevision += 1;
	}

	private async releaseDetachedOwnership(element: HTMLMediaElement): Promise<void> {
		const ownership = nativeMediaOwnership.byElement.get(element);
		if (!ownership) return;
		for (const [field, owned] of ownership) {
			try {
				const tolerance = field === 'volumeBase' || field === 'speed' ? 0.01 : 0;
				const current = readRestorableMediaField(element, field, owned.writer);
				if (!nativeValuesMatch(current, owned.lastApplied, tolerance)) continue;
				writeRestorableMediaField(element, field, owned.baseline, owned.writer);
				await (owned.writer === 'page-native' ? stablePageReadback : stableReadback)(
					() => readRestorableMediaField(element, field, owned.writer),
					{ signal: this.lifecycleController.signal },
				);
			} catch {
				// Detached page objects are best-effort release targets. Ownership is
				// still discarded so a later insertion cannot inherit a false baseline.
				nativeMediaOwnership.byElement.delete(element);
			}
		}
		nativeMediaOwnership.byElement.delete(element);
	}

	private targetKey(target: import('@nexus/contracts').MediaTarget): string {
		return `${target.documentId}:${target.mediaId}:${target.sourceRevision}`;
	}

	private replayDesired(
		target: MediaTarget,
		element?: HTMLMediaElement,
		allowPageMaturation = false,
	): void {
		if (this.tabId === null || Object.keys(this.desiredMedia).length === 0) return;
		const key = this.targetKey(target);
		if (this.replayPending.has(key)) {
			if (allowPageMaturation && element) {
				this.pageMaturationRequested.set(key, { target, element });
			}
			return;
		}
		const revision = this.desiredRevision;
		const alreadyApplied = (this.appliedDesiredRevision.get(key) ?? -1) >= revision;
		let patch: ControlPatch = { ...this.desiredMedia };
		const automaticFields: SpectraPageMediaField[] = [];
		if (alreadyApplied) {
			if (!allowPageMaturation || !element) return;
			patch = {};
			const ownership = nativeMediaOwnership.byElement.get(element);
			for (const field of SPECTRA_PAGE_MEDIA_FIELDS) {
				const attemptKey = `${key}:${field}`;
				const desired = this.desiredMedia[field];
				if (desired === undefined
					|| ownership?.get(field)?.writer !== 'dom-native'
					|| this.pending.get(target.mediaId)?.has(field)
					|| (this.automaticPageMaturationRevision.get(attemptKey) ?? -1) >= revision) {
					continue;
				}
				try {
					if (readPageMediaField(element, field) === null) continue;
				} catch {
					continue;
				}
				(patch as Record<string, unknown>)[field] = desired;
				automaticFields.push(field);
			}
			if (automaticFields.length === 0) return;
		}
		this.replayPending.add(key);
		void sendSpectraRequest('spectra.control.intent.submit', {
			tabId: this.tabId,
			source: 'restore',
			requestedCoverage: 'active-target',
			target,
			patch,
		}).then((response) => {
			if (!this.isCurrentTarget(target, element)) return;
			if (!response.ok) return;
			const applied = Object.values(response.data.fields)
				.every((field) => field?.phase === 'applied');
			if (applied) this.appliedDesiredRevision.set(key, revision);
			for (const field of automaticFields) {
				this.automaticPageMaturationRevision.set(`${key}:${field}`, revision);
			}
		}).catch(() => undefined).finally(() => {
			this.replayPending.delete(key);
			if (!this.isCurrentTarget(target, element)) return;
			const requested = this.pageMaturationRequested.get(key);
			if (!requested) return;
			this.pageMaturationRequested.delete(key);
			this.replayDesired(requested.target, requested.element, true);
		});
	}

	// post: read-only capability discovery for the page-entry volume-scale
	// verdict. Probes every registered element without writing, so a hostname
	// with any amplified controller is found while standard pages answer
	// unsupported in milliseconds.
	probePageScale(): { supported: boolean } {
		for (const { element } of this.registry.list()) {
			if (probePageMediaCapability(element, 'volumeBase')) return { supported: true };
		}
		return { supported: false };
	}

	private primeObserved(target: MediaTarget): void {
		if (this.observed.has(target.mediaId)) return;
		const { patch, observedStrategies } = this.read({
			target,
			fields: ['volumeBase', 'mediaMuted', 'speed', 'playing', 'currentTime', 'loop', 'pip', 'fullscreen', 'preservePitch'],
		});
		void sendSpectraRequest('spectra.audio.page-scale.record', {
			supported: observedStrategies.volumeBase === 'page-native',
		}).catch(() => undefined);
		this.observed.set(target.mediaId, patch);
	}

	private observe(
		mediaId: string,
		field: ControlField,
		actual: ControlValues[ControlField],
	): void {
		const values = this.observed.get(mediaId) ?? {};
		(values as Record<string, unknown>)[field] = actual;
		this.observed.set(mediaId, values);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.lifecycleController.abort(
			new ContentLifecycleError('cancelled', 'Native media executor disposed'),
		);
		for (const scopes of this.sourceOperationScopes.values()) {
			for (const scope of scopes) scope.abort(
				new ContentLifecycleError('cancelled', 'Native media executor disposed'),
			);
		}
		this.sourceOperationScopes.clear();
		for (const fields of this.pending.values()) {
			for (const pending of fields.values()) clearTimeout(pending.timeoutId);
		}
		this.pending.clear();
		this.observed.clear();
		this.appliedDesiredRevision.clear();
		this.replayPending.clear();
		this.automaticPageMaturationRevision.clear();
		this.pageMaturationRequested.clear();
		this.unsubscribeRegistry();
		if (this.ownsEffects) this.effects?.dispose();
		this.effects = null;
	}
}

let activeNativeMediaExecutor: NativeMediaExecutor | null = null;

export function getActiveNativeMediaExecutor(): NativeMediaExecutor | null {
	return activeNativeMediaExecutor;
}

export function registerNativeMediaExecutor(executor: NativeMediaExecutor): () => void {
	activeNativeMediaExecutor = executor;
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	): boolean => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| (candidate.type !== 'spectra.control.intent.execute'
				&& candidate.type !== 'spectra.control.actual.read'
				&& candidate.type !== 'spectra.control.page.scale.probe')) return false;
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Native control execution is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)
			|| (message.type !== 'spectra.control.intent.execute'
				&& message.type !== 'spectra.control.actual.read'
				&& message.type !== 'spectra.control.page.scale.probe')) {
			sendResponse(rpcFailure('invalid_request', 'Malformed native control intent'));
			return false;
		}
		executor.bindRequestContext(message.tabId, message.documentId);
		const operation = message.type === 'spectra.control.actual.read'
			? Promise.resolve().then(() => executor.read(message.payload))
			: message.type === 'spectra.control.page.scale.probe'
				? Promise.resolve().then(() => executor.probePageScale())
				: executor.execute(message.payload);
		void operation.then(
			(ack) => sendResponse(rpcSuccess(ack)),
			(error) => {
				const lifecycle = isContentLifecycleError(error);
				sendResponse(rpcFailure(
					lifecycle ? error.code : 'native_control_failed',
					 error instanceof Error ? error.message : String(error),
					lifecycle ? error.retryable : true,
				));
			},
		);
		return true;
	};
	chrome.runtime.onMessage.addListener(listener);
	return () => {
		chrome.runtime.onMessage.removeListener(listener);
		if (activeNativeMediaExecutor === executor) activeNativeMediaExecutor = null;
	};
}
