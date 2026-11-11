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
	type ControlObservationStrategies,
	type ControlObservationStrategy,
	type ControlPatch,
	type ControlReadRequest,
	type ControlReadResult,
	type ControlStrategy,
	type ControlStrategyFailure,
	type ControlValues,
	type ControlWriteState,
	type MediaTarget,
	type VolumeNativeRoute,
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
	holdPictureInPictureDisable,
	measureVideoFrameDuration,
	nativeValuesMatch,
	seekNativeMedia,
	stablePageReadback,
	stableReadback,
	writeSpeedWithSettleAck,
	writeWithStableEventAck,
	writePlaybackWithStableAck,
	type NativeMediaOperationOptions,
} from './native-media-async';
import {
	NativeWriteConfirmationRegistry,
	type RestorableMediaField,
} from './native-write-confirmation';
import {
	resolveNativeWriteMode,
	resolveNativeWriteSiteKey,
} from './native-write-policy';
import {
	recordNativeWrite,
} from './native-write-telemetry';
import {
	probePageMediaCapability,
	declaredPageSpeedAdmission,
	readPageMediaEvidence,
	readPageMediaField,
	writePageMediaField,
} from './page-media-bridge';
import {
	SPECTRA_PAGE_MEDIA_FIELDS,
	type SpectraPageMediaField,
} from '../../shared/page-media-bridge';
import { resolveDeclaredSiteAdapter } from '../../shared/site-adapter-registry';
import { isLiveMedia, isLiveUnsupportedField } from '../../shared/media-live';

interface PendingWrite {
	intentId: string;
	expected: unknown;
	tolerance: number;
	timeoutId: ReturnType<typeof setTimeout>;
}

interface MediaScene {
	id: string;
	root: HTMLMediaElement | Element;
	route: string;
	source: string | object | null;
	speed?: number;
}

const MAX_RETAINED_MEDIA_SCENES = 128;

type RestorableMediaWriter = 'declared-official' | 'page-native' | 'dom-native';

/**
 * Two writers answer through the page bridge; only `dom-native` touches the
 * element directly. `declared-official` is the same bridge call as
 * `page-native`, kept distinct so ownership, evidence and telemetry can name
 * *why* the bridge found a controller instead of inferring it.
 */
function isPageSideWriter(writer: RestorableMediaWriter): boolean {
	return writer === 'declared-official' || writer === 'page-native';
}

/**
 * Ownership normally moves up. A DOM writer is promoted once the page proves a
 * controller, and a generic controller is promoted to a declared one when a
 * site adapter's projection becomes readable. Anything else is a contradiction
 * this executor refuses to commit silently. Speed alone may return to DOM after
 * value admission excludes a page write, or a capability failure and proven
 * two-channel baseline restoration, retaining
 * the exact prior ownership identity and original physical baseline.
 */
const WRITER_RANK: Readonly<Record<RestorableMediaWriter, number>> = {
	'dom-native': 0,
	'page-native': 1,
	'declared-official': 2,
};
// Page attempt, page rollback, prior DOM rollback, and final DOM attempt each
// have a bounded 750ms settle plus two bounded rendering boundaries.
const SPEED_PENDING_BUDGET_MS = 4_000;

/**
 * The wire contract only knows `page-native` and `dom-native`
 * (`CONTROL_STRATEGIES`). `declared-official` is an internal routing fact and
 * must never widen that enum — it carries bit order and rule tuples in
 * `CONTROL_STRATEGY_RULES`. Anything that reports upward maps back here.
 */
function wireStrategy(writer: RestorableMediaWriter): ControlStrategy {
	return writer === 'declared-official' ? 'page-native' : writer;
}

/** Observation narrows further: it excludes the observe/unsupported strategies. */
function observationStrategy(writer: RestorableMediaWriter): ControlObservationStrategy {
	return writer === 'dom-native' ? 'dom-native' : 'page-native';
}


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
	/** This source's page writer proved unable to carry a physical speed. */
	rejectedPageSpeed?: number;
}

interface RestorableMediaWriteState {
	actual: ControlValues[RestorableMediaField];
	writer: RestorableMediaWriter;
	upgradeFrom?: OwnedMediaField;
	controllerBaseline?: number;
	/** No page setter ran: value admission proves this handoff is mutation-free. */
	speedFallbackFrom?: OwnedMediaField | null;
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

// note: the audio runtime is the only component that knows which writer owns a
// field right now, so it returns each value with that provenance.
export type AudioRuntimeReadResult = Pick<ControlReadResult, 'patch' | 'observedStrategies' | 'prospectiveBoostRoute'>;

export interface AudioRuntimeControlDelegate {
	apply(intent: ControlIntent, patch: ControlPatch, documentOutput?: boolean): Promise<ControlFieldStates>;
	read(fields: readonly ControlField[]): AudioRuntimeReadResult;
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

// Use the platform's track inventory, never a hostname or player constructor.
// Unknown sources retain the native route; absence is proved only for an actual
// video-only MediaStream, whose video volume property cannot scale page audio.
function nativeAudioAbsent(element: HTMLMediaElement): boolean {
	const stream = element.srcObject;
	if (typeof MediaStream === 'undefined' || !(stream instanceof MediaStream)) return false;
	return MediaStream.prototype.getVideoTracks.call(stream).length > 0
		&& MediaStream.prototype.getAudioTracks.call(stream).length === 0;
}

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

/** A stale revision is the usual cause, so name it instead of a bare failure. */
function noTargetMessage(target?: MediaTarget): string {
	return target
		? `No active video target for ${target.mediaId}@${target.sourceRevision}`
		: 'No active video target';
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

/**
 * The Picture-in-Picture session was established and then terminated by the
 * page itself: it keeps `disablePictureInPicture`, or it exits on
 * `enterpictureinpicture`. That is the site's own policy, not an internal
 * readback disagreement, so it answers with the canonical `policy-denied`
 * failure code instead of pretending the extension's own proof failed.
 */
class PictureInPictureVetoedError extends Error {
	constructor() {
		super('This site disables Picture-in-Picture, so the session was terminated');
		this.name = 'PictureInPictureVetoedError';
	}
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
	// Page speed state is a write witness, never physical playback authority.
	if (field === 'speed') return element.playbackRate;
	if (isPageSideWriter(writer) && isPageMediaField(field)) {
		const actual = readPageMediaField(element, field);
		if (actual === null) throw new Error(`Page-media ${field} reader is no longer available`);
		return actual;
	}
	return readDomRestorableMediaField(element, field);
}

function readRestorableMediaFieldWithWriter(
	element: HTMLMediaElement,
	field: RestorableMediaField,
): RestorableMediaWriteState {
	const owned = nativeMediaOwnership.byElement.get(element)?.get(field);
	// Every speed observation stays physical, including page-owned writes and
	// rates absent from a page menu. Volume/mute retain semantic page-gesture
	// discovery for legitimately non-linear page controllers.
	if (owned && (
		!isPageMediaField(field)
		|| field === 'speed'
	)) {
		return {
			actual: readRestorableMediaField(element, field, owned.writer),
			writer: owned.writer,
		};
	}
	if (isPageMediaField(field)) {
		try {
			const evidence = readPageMediaEvidence(element, field);
			if (evidence !== null) {
				return {
					actual: field === 'speed' ? element.playbackRate : evidence.actual,
					...(field === 'speed' ? { controllerBaseline: evidence.actual as number } : {}),
					// The bridge names its own source, so a generic hit is never
					// mislabelled as declared knowledge.
					writer: evidence.adapterId ? 'declared-official' : 'page-native',
				};
			}
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
	requested: ControlValues[ControlField],
): RestorableMediaWriteState {
	const owned = nativeMediaOwnership.byElement.get(element)?.get(field);
	const admission = field === 'speed' ? declaredPageSpeedAdmission(element, requested as number) : null;
	if (admission === false) {
		return { actual: element.playbackRate, writer: 'dom-native', speedFallbackFrom: owned ?? null };
	}
	if (owned) {
		if (field === 'speed' && owned.writer === 'dom-native' && owned.rejectedPageSpeed === requested) {
			return { actual: element.playbackRate, writer: owned.writer };
		}
		if (owned.writer === 'dom-native' && isPageMediaField(field)) {
			try {
				const evidence = readPageMediaEvidence(element, field);
				if (evidence !== null) {
					return {
						actual: field === 'speed' ? element.playbackRate : evidence.actual,
						...(field === 'speed' ? { controllerBaseline: evidence.actual as number } : {}),
						writer: evidence.adapterId ? 'declared-official' : 'page-native',
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
		const controllerBaseline = field === 'speed' && isPageSideWriter(owned.writer)
			? readPageMediaField(element, 'speed') : null;
		return {
			actual: readRestorableMediaField(element, field, owned.writer),
			writer: owned.writer,
			...(controllerBaseline !== null ? { controllerBaseline } : {}),
		};
	}
	return readRestorableMediaFieldWithWriter(element, field);
}

function writeRestorableMediaField(
	element: HTMLMediaElement,
	field: RestorableMediaField,
	value: ControlValues[RestorableMediaField],
	writer: RestorableMediaWriter,
	explicitUnmute = false,
): ControlValues[RestorableMediaField] {
	if (field === 'mediaMuted' && !explicitUnmute) assertUnmuteAdmitted(element, value as boolean);
	if (isPageSideWriter(writer) && isPageMediaField(field)) {
		const actual = writePageMediaField(element, field, value);
		if (actual === null) throw new PageMediaCapabilityUnavailableError(field);
		return actual;
	}
	switch (field) {
		case 'volumeBase': return writeNativeVolumeBase(element, value as number);
		case 'mediaMuted': return writeNativeMediaMuted(element, value as boolean, explicitUnmute);
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

export function writeNativeMediaMuted(element: HTMLMediaElement, muted: boolean, explicitUnmute = false): boolean {
	if (!explicitUnmute) assertUnmuteAdmitted(element, muted);
	if (element.muted === muted) return element.muted;
	element.muted = muted;
	return element.muted;
}

function requiresUnmuteActivation(element: HTMLMediaElement, muted: boolean): boolean {
	return !muted && element.muted
		&& globalThis.navigator?.userActivation?.hasBeenActive === false;
}

/**
 * Automatic restoration must not interrupt muted autoplay. Explicit controls
 * instead let the browser decide: document activation is not its whole autoplay
 * policy. Their awaited writer verifies that unmuting did not stop playback.
 */
function assertUnmuteAdmitted(element: HTMLMediaElement, muted: boolean): void {
	if (requiresUnmuteActivation(element, muted)) {
		throw new DOMException('Interact with the document before unmuting its media', 'NotAllowedError');
	}
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
	options: NativeMediaOperationOptions & { explicitUnmute?: boolean } = {},
): Promise<ControlValues[SpectraPageMediaField]> {
	assertNativeOperationCurrent(options);
	const preservePlayback = field === 'mediaMuted' && desired === false
		&& !element.paused && !element.ended;
	const pageSide = isPageSideWriter(writer);
	const read = (): ControlValues[SpectraPageMediaField] => (
		pageSide
			? readRestorableMediaField(element, field, writer)
			: readDomRestorableMediaField(element, field)
	) as ControlValues[SpectraPageMediaField];
	let actual: ControlValues[SpectraPageMediaField];
	const write = (): void => {
		// Keep one writer authoritative. In particular, do not "help" a declared
		// speed controller with a second DOM assignment: xgplayer observes that
		// assignment as an external rate change and can reconcile its panel back
		// to the controller's previous value. Repeating the controller write is
		// what repairs both its rendered mirror and the media after a source swap.
		writeRestorableMediaField(element, field, desired, writer, options.explicitUnmute);
	};
		if (pageSide && field === 'speed') {
			// Allow asynchronous page application, but never acknowledge controller
			// state that the media never plays. Both witnesses must stay coherent.
			const coherent = await writeSpeedWithSettleAck(
				write,
				() => {
					const controller = readPageMediaField(element, 'speed');
					if (controller === null) throw new PageMediaCapabilityUnavailableError('speed');
					return nativeValuesMatch(desired, controller, tolerance)
						&& nativeValuesMatch(desired, element.playbackRate, tolerance);
				},
				true,
				0,
				750,
				options,
			);
			if (!coherent) throw new Error('Page speed readback diverged at the final render boundary');
			actual = element.playbackRate;
		} else if (pageSide) {
			write();
			actual = await stablePageReadback(read, options);
		} else if (field === 'speed') {
			actual = await writeSpeedWithSettleAck(
				write,
				read,
				desired,
				tolerance,
				750,
				options,
			);
		} else {
		actual = await writeWithStableEventAck(
			element,
			'volumechange',
			write,
			read,
			desired,
			tolerance,
			750,
			options,
		);
	}
	assertNativeOperationCurrent(options);
	if (preservePlayback && element.paused && !element.ended) {
		throw new DOMException('Unmuting interrupted media playback; interact with the player before retrying', 'SecurityError');
	}
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
	controllerBaseline?: number,
): Promise<boolean> {
	// An explicitly unavailable request never called a page setter. Every other
	// page failure may fall through only after the same candidate proves that its
	// baseline is stable again.
	if (error instanceof PageMediaCapabilityUnavailableError) return true;
	try {
		if (field === 'speed') {
			const pageBaseline = controllerBaseline ?? baseline;
			const coherent = (): boolean => nativeValuesMatch(readPageMediaField(element, 'speed'), pageBaseline, tolerance)
				&& nativeValuesMatch(element.playbackRate, pageBaseline, tolerance);
			if (coherent()) {
				if (!await stablePageReadback(coherent, options)) return false;
			} else {
				await writeRestorableMediaFieldWithStableAck(element, field, pageBaseline, 'page-native', tolerance, options);
			}
			return true;
		}
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

// Retry only an unfinished, already-authorized source restore. Media events
// can advance it sooner; these finite delays cover a lost/last maturity event.
const SOURCE_RESTORE_RETRY_DELAYS_MS = [100, 300, 1000] as const;
interface PendingSourceRestore {
	revision: number;
	visit: number;
	remaining: ControlPatch;
	attempts: number;
	timer?: ReturnType<typeof setTimeout>;
}

export class NativeMediaExecutor {
	private readonly pending = new Map<string, Map<ControlField, PendingWrite>>();
	private readonly observed = new Map<string, Partial<ControlValues>>();
	private readonly desiredMedia: ControlPatch = {};
	private readonly appliedDesiredRevision = new Map<string, number>();
	private readonly replayPending = new Set<string>();
	private readonly sourceRestores = new Map<string, PendingSourceRestore>();
	private readonly automaticPageMaturationRevision = new Map<string, number>();
	private readonly pageMaturationRequested = new Map<string, {
		target: MediaTarget;
		element: HTMLMediaElement;
	}>();
	private readonly pageObservations = new Map<string, {
		target: MediaTarget;
		patch: ControlPatch;
		observedStrategies: ControlObservationStrategies;
	}>();
	private pageObservationFlushQueued = false;
	private effects: VideoEffectsControllerPort | null;
	private readonly ownsEffects: boolean;
	private readonly registry: MediaRegistry;
	private readonly unsubscribeRegistry: () => void;
	private audioRuntimeDelegate: AudioRuntimeControlDelegate | null = null;
	private volumeRouteReporter: ((route: VolumeNativeRoute) => void) | null = null;
	private tabId: number | null = null;
	private desiredRevision = 0;
	private get selectionRevision(): number { return this.registry.selectionRevision ?? 0; }
	private mediaIntentReleased = false;
	private readonly scenes = new Map<string, MediaScene>();
	private readonly sceneRoots = new WeakMap<Element, Map<string, MediaScene>>();
	private readonly targetScenes = new Map<string, MediaScene>();
	private nextSceneId = 1;
	private disposed = false;
	// Set when the runtime attaches before the document has a selection. The
	// first selection completes that publication exactly once; later selections
	// keep the ordinary target-only path.
	private attachPublicationPending = false;
	// The element the last publication described. An SPA route switch selects a
	// different player in the same document, and that player's own physical
	// values are the only correct snapshot for the badge. A new identity on the
	// same element (source revision/media id) stays target-only so a cold
	// page-semantic sample is never reattributed.
	private publishedSelectionElement: HTMLMediaElement | null = null;
	private readonly lifecycleController = new AbortController();
	private readonly sourceOperationScopes = new Map<string, Set<AbortController>>();
	// Deferred stabilization proofs, keyed `<mediaId>:<field>`. At most one runs
	// per field: a newer write cancels the proof of the one it supersedes, so a
	// fast drag cannot stack listeners or let a stale verdict overwrite a newer
	// value.
	private readonly writeConfirmations = new NativeWriteConfirmationRegistry();
	// The last presentation kind announced for a media target. Only a change is
	// worth a message, and only `live` is announced at all: on demand is the
	// default, so saying it for every element on every page is pure traffic.
	private readonly presentationFacts = new Map<string, boolean>();

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

	mediaIntentState(): 'unset' | 'retained' | 'released' {
		if (this.disposed || this.mediaIntentReleased) return 'released';
		return Object.keys(this.desiredMedia).length > 0 ? 'retained' : 'unset';
	}

	private sceneFor(target: MediaTarget, element: HTMLMediaElement): MediaScene {
		const key = this.targetKey(target);
		const exact = this.targetScenes.get(key);
		const selector = resolveDeclaredSiteAdapter('speed')?.projection?.rootSelector;
		const candidate = selector ? element.closest(selector) : null;
		// A declared root is usable only when it names exactly this media. Nested
		// or multi-media roots cannot merge unrelated playback preferences.
		const exactRoot = candidate && candidate.querySelectorAll('video,audio').length === 1 ? candidate : null;
		const root = exactRoot ?? element;
		const route = typeof window === 'undefined' ? '' : window.location.href;
		const source = element.srcObject ?? (element.currentSrc || element.src || null);
		if (exact && exact.root === root && exact.route === route
			&& (exactRoot !== null || exact.source === source)) return exact;
		let routes = this.sceneRoots.get(root);
		if (!routes) { routes = new Map(); this.sceneRoots.set(root, routes); }
		let scene = exactRoot ? routes.get(route) : source === null ? undefined
			: [...this.scenes.values()].find((value) => value.root === root && value.route === route && value.source === source);
		if (!scene) {
			scene = { id: `scene:${this.nextSceneId++}`, root, route, source };
			if (exactRoot) routes.set(route, scene);
			this.scenes.set(scene.id, scene);
		}
		this.targetScenes.set(key, scene);
		if (exact && exact !== scene) {
			// A route/root change can replace the scene while the media identity
			// stays constant. Its prior scene's application proof cannot settle
			// the new scene, including after the page released field ownership.
			this.appliedDesiredRevision.delete(key);
			for (const attemptKey of this.automaticPageMaturationRevision.keys()) {
				if (attemptKey.startsWith(`${key}:`)) this.automaticPageMaturationRevision.delete(attemptKey);
			}
		}
		while (this.scenes.size > MAX_RETAINED_MEDIA_SCENES) {
			const oldest = this.scenes.values().next().value as MediaScene;
			this.scenes.delete(oldest.id);
			const oldRoutes = this.sceneRoots.get(oldest.root);
			if (oldRoutes?.get(oldest.route) === oldest) oldRoutes.delete(oldest.route);
			for (const [binding, value] of this.targetScenes) if (value === oldest) this.targetScenes.delete(binding);
		}
		return scene;
	}

	/** The browser navigation settlement signal wakes the latest obligation. */
	reconcileRoute(_routeIdentity: string): void {
		if (this.disposed) return;
		const selected = this.registry.resolve(null);
		if (!selected) return;
		// Selection/play reports can have met the navigation fence. Settlement is
		// an independent observation boundary, even without a desired template or
		// another play event. Publish truth before scheduling any restore effect.
		const actual = this.read({ target: selected.target, fields: ['playing'] });
		void sendSpectraRequest('spectra.content.target.changed', {
			target: selected.target, mediaObservation: actual.mediaObservation,
		}, { documentId: selected.target.documentId }).catch(() => undefined);
		void sendSpectraRequest('spectra.control.intent.submit', {
			source: 'page', requestedCoverage: 'active-target', target: selected.target,
			patch: actual.patch, observedStrategies: actual.observedStrategies, mediaObservation: actual.mediaObservation,
			...(typeof actual.live === 'boolean' ? { live: actual.live } : {}),
		}).catch(() => undefined);
		this.replayDesired(selected.target, selected.element, true);
	}

	/**
	 * Publish a selection that already existed when this runtime attached.
	 *
	 * Media can register and be selected before the heavy runtime exists: the
	 * document reports media presence, and only then does the background acquire
	 * this executor. No `selected` event will fire for that earlier selection, so
	 * without this publish the canonical snapshot stays empty until an explicit
	 * surface performs a passive read. That read is what used to look like "the
	 * Popup is the switch".
	 */
	publishCurrentSelection(): void {
		if (this.disposed) return;
		const selected = this.registry.resolve(null);
		if (!selected) {
			// The restore boundary can attach before the player exists. The first
			// selection then has to complete the attach publication; otherwise the
			// document keeps an empty snapshot until a native change or a Popup read.
			this.attachPublicationPending = true;
			return;
		}
		this.publishedSelectionElement = selected.element;
		this.publishEstablishedSelection(selected.target, selected.element, true);
	}

	// A target announcement is not a snapshot. The badge projects physical
	// values, and a document can establish its selection after the runtime
	// attaches (the live player settles late). `publishValues` completes that
	// attach publication, and also seeds a replacement player selected by an SPA
	// route switch; a selection that only changes identity on the same element
	// keeps the target-only path so a page observation is never fabricated from a
	// cold or superseded selection.
	private publishEstablishedSelection(
		target: MediaTarget,
		element: HTMLMediaElement,
		publishValues = false,
	): void {
		this.primeObserved(target);
		this.publishPresentationKind(target, element);
		void sendSpectraRequest(
			'spectra.content.target.changed',
			{ target, mediaObservation: this.registry.captureObservation?.() },
			{ documentId: target.documentId },
		).catch(() => undefined);
		this.replayDesired(target, element, true);
		if (!publishValues) return;
		const actual = this.read({
			target,
			fields: ['volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'playing'],
		});
		this.queuePageObservation(target, actual.patch, actual.observedStrategies);
	}

	setAudioRuntimeDelegate(delegate: AudioRuntimeControlDelegate | null): void {
		this.audioRuntimeDelegate = delegate;
	}

	/**
	 * Publish the writer that carries this document's native volume scale.
	 *
	 * The palette decides whether a gesture hands the document to a processor
	 * above the native ceiling, and only the writer knows whether the page has an
	 * amplifier of its own. Reporting it here - at the only place that derives
	 * `volumeBase`'s provenance - is what lets a live gesture predict the route
	 * instead of waiting for the acknowledgement that settles it.
	 */
	setVolumeRouteReporter(reporter: ((route: VolumeNativeRoute) => void) | null): void {
		this.volumeRouteReporter = reporter;
	}

	private reportVolumeRoute(strategy: ControlObservationStrategy | ControlStrategy | undefined): void {
		if (strategy !== 'page-native' && strategy !== 'dom-native') return;
		this.volumeRouteReporter?.(strategy);
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
		requireSelected = false,
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
		if (requireSelected && !this.isSelectedTarget(target, element)) {
			throw new ContentLifecycleError('stale-media-source', 'Playback target is no longer the selected media');
		}
	}

	private isSelectedTarget(target: MediaTarget, element: HTMLMediaElement): boolean {
		const selected = this.registry.resolve(null);
		// Same control identity, not the same resource revision: a source swap
		// rebases the selected target while the element stays selected.
		return this.isCurrentTarget(target, element) && !!selected && selected.element === element
			&& selected.target.mediaId === target.mediaId;
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
		const effective = this.normalizeIntentTarget(intent);
		try {
			return await this.executeAttempt(effective);
		} catch (error) {
			// A failure here means the tab's player changed while this write was in
			// flight. The registry already decided what the tab controls, so the
			// same gesture is re-applied there exactly once.
			const retryTarget = this.retryTarget(effective, error);
			// An automatic restore is best-effort by design: its obligation is
			// re-issued on the next lifecycle event, and the background already
			// receives the structured failure. Only a gesture failure is worth a
			// console warning.
			if (!retryTarget) throw this.annotateStale(error, effective.target, effective.source === 'restore');
			try {
				return await this.executeAttempt({ ...effective, target: retryTarget });
			} catch (retryError) {
				throw this.annotateStale(retryError, retryTarget, effective.source === 'restore');
			}
		}
	}

	/**
	 * Which identity owns a stale write, if any.
	 *
	 * A retired identity is replaced by the selection the registry made. An
	 * `active-target` intent is addressed to the tab rather than to a particular
	 * historical element, so it follows the selection even when the previous
	 * player is still registered — the Background projection is one message
	 * behind every SPA player swap, and that lag must not cost the first gesture.
	 * A `restore` intent is bound to one source visit and never follows a change.
	 * Returning `null` leaves the original failure intact.
	 */
	private retryTarget(intent: ControlIntent, error: unknown): MediaTarget | null {
		if (this.disposed || !isContentLifecycleError(error) || error.code !== 'stale-media-source') return null;
		if (intent.source === 'restore') return null;
		const successor = this.retiredSuccessor(intent);
		if (successor) return successor;
		if (intent.requestedCoverage !== 'active-target' || this.registry.selectionPinnedByViewer) return null;
		const selected = this.registry.resolve(null);
		if (!selected) return null;
		const requested = intent.target;
		if (requested && (requested.documentId !== selected.target.documentId
			|| requested.frameId !== selected.target.frameId
			|| requested.kind !== selected.target.kind)) return null;
		if (requested && requested.mediaId === selected.target.mediaId
			&& requested.sourceRevision === selected.target.sourceRevision) return null;
		return selected.target;
	}

	/**
	 * An `active-target` intent describes the viewer's current tab, not a
	 * particular historical element. The Background projection can name an
	 * element this document never registered (per-runtime mediaId counters), or
	 * one that is still registered but has already been superseded by the
	 * registry's selection. The registry owns the document, so the intent is
	 * applied to its selection instead of failing the first gesture after every
	 * player swap (SP-22.3 §2).
	 */
	private normalizeIntentTarget(intent: ControlIntent): ControlIntent {
		if (intent.requestedCoverage !== 'active-target') return intent;
		const selected = this.registry.resolve(null);
		if (!selected) return intent;
		const requested = intent.target;
		if (requested && (requested.documentId !== selected.target.documentId
			|| requested.frameId !== selected.target.frameId
			|| requested.kind !== selected.target.kind)) return intent;
		if (requested && requested.mediaId === selected.target.mediaId
			&& requested.sourceRevision === selected.target.sourceRevision) return intent;
		// Establishing the concrete target here (rather than resolving it inside
		// the write) is what lets a failure name the identity it compared and lets
		// the successor retry own a targetless intent.
		return { ...intent, target: selected.target };
	}

	/**
	 * A stale failure must state which identities were compared. Without that the
	 * report is a symptom the viewer cannot act on and the cause cannot be traced
	 * from a single repro (SP-22.3 §2).
	 */
	private annotateStale(error: unknown, requested?: MediaTarget | null, quiet = false): unknown {
		if (!isContentLifecycleError(error) || error.code !== 'stale-media-source') return error;
		const diagnostic = this.registry.describeMedia?.();
		const identity = requested
			? `requested=${requested.documentId}/${requested.mediaId}@${requested.sourceRevision}(${requested.kind})`
			: 'requested=none';
		if (!quiet) console.warn('[SPECTRA][stale-media-source]', identity, diagnostic);
		return diagnostic
			? new ContentLifecycleError('stale-media-source', `${error.message} | ${identity} | ${diagnostic}`)
			: error;
	}

	private retiredSuccessor(intent: ControlIntent): import('@nexus/contracts').MediaTarget | null {
		const requested = intent.target;
		if (!requested || !this.registry.wasRetiredControl?.(requested)) return null;
		const selected = this.registry.resolve(null);
		if (!selected || selected.target.kind !== requested.kind
			|| selected.target.mediaId === requested.mediaId) return null;
		return selected.target;
	}

	private async executeAttempt(intent: ControlIntent): Promise<ControlApplyAck> {
		this.tabId = intent.tabId;
		const fields: ControlFieldStates = {};
		const selectionRevision = this.selectionRevision;
		const runtimePatch: ControlPatch = {};
		const directEntries: Array<[ControlField, ControlValues[ControlField]]> = [];
		const audioTarget = this.registry.resolve(intent.target);
		const outputRead = this.audioRuntimeDelegate?.read(['volumeBase', 'mediaMuted']);
		const documentOutput = outputRead?.observedStrategies.volumeBase === 'capture'
			// Native preferences can arrive before a live stream's audio track.
			// Restore its element/template without manufacturing Capture authority.
			|| Boolean(intent.source !== 'restore' && audioTarget && nativeAudioAbsent(audioTarget.element)
				&& !isPageSideWriter(readRestorableMediaFieldWithWriter(audioTarget.element, 'volumeBase').writer));
		this.audioRuntimeDelegate?.synchronizeNative(intent.actualContext);
		for (const [rawField, rawValue] of Object.entries(intent.patch)) {
			const field = rawField as ControlField;
			const value = rawValue as ControlValues[ControlField];
			if (AUDIO_RUNTIME_FIELDS.has(field)
				|| documentOutput && (field === 'volumeBase' || field === 'mediaMuted')) {
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
		const scene = resolved ? this.sceneFor(resolved.target, resolved.element) : null;
		// A restore obligation is bound to the desired revision, the scene and the
		// selected element — all of which are compared here. The selection visit is
		// deliberately not part of this fence: an automatic restore that arrives
		// after an unrelated visit advance still describes the current template for
		// the element it names, and rejecting it surfaced a stale error (and
		// suppressed the page's own volume) for a write that was never wrong.
		if (intent.mediaRestore && (!resolved || !scene
			|| intent.mediaRestore.revision !== this.desiredRevision
			|| intent.mediaRestore.scene !== scene.id
			|| !this.isSelectedTarget(resolved.target, resolved.element))) {
			throw new ContentLifecycleError('stale-media-source', 'The media restore obligation has been superseded');
		}
		const sourceScope = resolved ? this.beginSourceOperation(resolved.target) : null;
		const operationSignal = this.operationSignal(sourceScope?.signal);
		try {
		if (intent.source === 'restore') {
			for (const [field, value] of directEntries) {
				if (isRestorableMediaField(field) && !intent.mediaRestore && this.desiredMedia[field] === undefined) {
					this.rememberDesired(field, value);
				}
			}
		}
		for (const [field, requested] of directEntries) {
			if (intent.mediaRestore && resolved && isRestorableMediaField(field)
				&& this.sourceRestores.get(this.targetKey(resolved.target))?.remaining[field] === undefined
				&& !nativeMediaOwnership.byElement.get(resolved.element)?.has(field)) {
				this.putError(fields, field, requested, intent, 'policy-denied', 'Page ownership superseded this restore field');
				continue;
			}
			const value = intent.source !== 'restore' ? requested
				: field === 'speed' && scene?.speed !== undefined ? scene.speed
					: !intent.mediaRestore && isRestorableMediaField(field) ? this.desiredMedia[field] ?? requested : requested;
			await this.applyField(intent, resolved, field, value, fields, operationSignal);
			const state = fields[field];
			if (isRestorableMediaField(field)
				&& state?.phase === 'applied'
				&& state.desired !== null && intent.source !== 'restore') {
				this.rememberDesired(field, state.desired);
				if (field === 'speed' && scene) scene.speed = state.desired as number;
			}
		}
		this.synchronizeAppliedNative(fields);
		if (Object.keys(runtimePatch).length > 0) {
			if (this.audioRuntimeDelegate) {
				Object.assign(fields, await this.audioRuntimeDelegate.apply(intent, runtimePatch, documentOutput));
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
			const remaining = this.sourceRestores.get(this.targetKey(resolved.target))?.remaining;
			if (restored && selectionRevision === this.selectionRevision
				&& (!remaining || Object.keys(remaining).every((field) => fields[field as ControlField]?.phase === 'applied'))) {
				this.appliedDesiredRevision.set(this.targetKey(resolved.target), this.desiredRevision);
			}
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
		if (resolved && directEntries.length > 0) {
			if (onlyVideoFields) {
				// Audio may acquire activeMedia while the same activeVideo retains its
				// own presentation controls. Fence that separate selection explicitly.
				const selectedVideo = videoResolver.resolveVideo?.(null) ?? this.registry.resolve(null);
				if (!selectedVideo || selectedVideo.element !== resolved.element
					|| this.targetKey(selectedVideo.target) !== this.targetKey(resolved.target)) {
					throw new ContentLifecycleError('stale-media-source', 'The active video changed before its control ACK');
				}
			} else {
				if (selectionRevision !== this.selectionRevision) {
					throw new ContentLifecycleError('stale-media-source', 'The media selection visit changed before its control ACK');
				}
				this.assertCurrentTarget(resolved.target, resolved.element, operationSignal, true);
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
			mediaObservation: this.registry.captureObservation?.(),
		};
		} catch (error) {
			// Initial restore seeded its authorized template before attempting the
			// write. Wake that obligation on the current source even if the final
			// selection event preceded the rejected ACK. Failed explicit fields must
			// never manufacture a template or bypass the coordinator's target policy.
			if (isContentLifecycleError(error) && error.code === 'stale-media-source'
				&& intent.source === 'restore' && !intent.mediaRestore) {
				const live = this.registry.resolve(null);
				if (live) this.replayDesired(live.target, live.element, true);
			}
			throw error;
		} finally {
			sourceScope?.close();
			if (intent.source !== 'restore') {
				const live = this.registry.resolve(null);
				if (live && Object.keys(this.sourceRestores.get(this.targetKey(live.target))?.remaining ?? {}).length > 0) {
					this.replayDesired(live.target, live.element, true);
				}
			}
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
			if (!requested) throw new Error(noTargetMessage(explicitTarget));
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
		if (!resolved) throw new Error(field === 'playing' ? 'No active media target' : noTargetMessage(explicitTarget));
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

	async togglePlayback(intent: ControlOperationIntent<'playback-toggle'>): Promise<{
		target: MediaTarget; actual: boolean; fields: ControlFieldStates;
		mediaObservation?: ControlApplyAck['mediaObservation'];
	}> {
		this.bindRequestContext(intent.tabId, intent.documentId);
		const selected = this.registry.resolve(intent.target);
		if (!selected) throw new ContentLifecycleError('stale-media-source', 'No selected media is available for playback');
		const playing = selected.element.paused;
		const ack = await this.execute({
			intentId: intent.operationId, tabId: intent.tabId, documentId: intent.documentId,
			generation: intent.generation, baseRevision: intent.baseRevision, source: intent.source,
			requestedCoverage: 'active-target', target: selected.target, actualContext: {}, patch: { playing },
		});
		const state = ack.fields.playing;
		if (state?.phase !== 'applied' || typeof state.actual !== 'boolean') throw new Error(state?.lastError?.message ?? 'Playback was not applied');
		return { target: selected.target, actual: state.actual, fields: ack.fields, mediaObservation: ack.mediaObservation };
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
					const actual = await (isPageSideWriter(owned.writer) ? stablePageReadback : stableReadback)(
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
							strategy: wireStrategy(owned.writer),
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
		for (const scene of this.scenes.values()) delete scene.speed;
		this.mediaIntentReleased = true;
		this.desiredRevision += 1;
		this.clearSourceRestores();
		this.automaticPageMaturationRevision.clear();
		this.pageMaturationRequested.clear();
		return { releasedFields: [...released], fields };
	}

	read(request: ControlReadRequest): ControlReadResult {
		if (this.disposed) throw new Error('Native media executor is disposed');
		const patch: ControlPatch = {};
		const observedStrategies: ControlObservationStrategies = {};
		let prospectiveBoostRoute: ControlReadResult['prospectiveBoostRoute'];
		const runtimeFields = request.fields.filter((field) => AUDIO_RUNTIME_FIELDS.has(field)
			|| field === 'volumeBase' || field === 'mediaMuted');
		if (runtimeFields.length > 0 && this.audioRuntimeDelegate) {
			const runtime = this.audioRuntimeDelegate.read(runtimeFields);
			prospectiveBoostRoute = runtime.prospectiveBoostRoute;
			Object.assign(patch, runtime.patch);
			Object.assign(observedStrategies, runtime.observedStrategies);
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
						observedStrategies[field] = field === 'speed' ? 'dom-native' : observationStrategy(observed.writer);
						break;
					}
					case 'preservePitch':
						if ('preservesPitch' in element) {
							actual = (element as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch;
							observedStrategies.preservePitch = 'dom-native';
						}
						break;
					case 'playing': actual = !element.paused; observedStrategies.playing = 'dom-native'; break;
					case 'currentTime': actual = Number.isFinite(element.currentTime) && element.currentTime >= 0 ? element.currentTime : 0; observedStrategies.currentTime = 'dom-native'; break;
					case 'loop': actual = element.loop; observedStrategies.loop = 'dom-native'; break;
					case 'pip': actual = document.pictureInPictureElement === element; observedStrategies.pip = 'dom-native'; break;
					case 'fullscreen': actual = fullscreenOwnsMedia(element); observedStrategies.fullscreen = 'dom-native'; break;
					case 'rotation': actual = effectState?.rotation; observedStrategies.rotation = 'extension-css'; break;
					case 'mirrored': actual = effectState?.mirrored; observedStrategies.mirrored = 'extension-css'; break;
					case 'fill': actual = effectState?.fill; observedStrategies.fill = 'extension-css'; break;
					case 'filterEnabled': actual = effectState?.filterEnabled; observedStrategies.filterEnabled = 'extension-css'; break;
					case 'filter': actual = effectState?.filter; observedStrategies.filter = 'extension-css'; break;
					case 'dimEnabled': actual = effectState?.dimEnabled; observedStrategies.dimEnabled = 'extension-overlay'; break;
					case 'dimOpacity': actual = effectState?.dimOpacity; observedStrategies.dimOpacity = 'extension-overlay'; break;
				}
				if (actual !== undefined) (patch as Record<string, unknown>)[field] = actual;
			}
			if (Object.keys(patch).length > 0) {
				this.reportVolumeRoute(observedStrategies.volumeBase);
				return { target, patch, observedStrategies,
					mediaObservation: this.registry.captureObservation?.(),
					live: isLiveMedia(element),
					// An unresolved page-native scale may absorb the crossing itself.
					// Predict only a standard DOM scale; the current active owner remains
					// authoritative regardless of this candidate.
					...(request.fields.includes('volumeBase') ? { prospectiveBoostRoute:
						observedStrategies.volumeBase === 'dom-native' ? prospectiveBoostRoute ?? null : null } : {}),
					...(nativeAudioAbsent(element) ? { nativeAudioAbsent: true } : {}) };
			}
		}
		if (Object.keys(patch).length === 0) {
			throw new Error('No requested control field has an observable actual value');
		}
		this.reportVolumeRoute(observedStrategies.volumeBase);
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
			// An empty document or stale explicit target has no physical witness.
			// Only restore keeps its separately staged template for later media;
			// a failed explicit request must never become an applied value/replay.
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

	const explicitUnmute = intent.source === 'popup' || intent.source === 'hotkey' || intent.source === 'remote';
	// Only automatic restoration uses the conservative activation heuristic.
	// Explicit controls must reach the browser and await the physical outcome.
	if (field === 'mediaMuted' && !explicitUnmute && requiresUnmuteActivation(element, value as boolean)) {
		this.putError(fields, field, value, intent, 'user-activation-required',
			'Interact with the document before unmuting its media', false);
		return;
	}

	const strategy = contentControlStrategy(field, intent.requestedCoverage);
		if (strategy !== 'dom-native') {
			this.putError(fields, field, value, intent, 'capability-unavailable', 'No complete standard media strategy is available');
			return;
		}

		// A live stream has no timeline to transform. Writing the rate anyway is
		// what produced a `readback-mismatch` seconds later, after the player had
		// already reverted it, and it looked like a broken control instead of an
		// inapplicable one. Refuse before the write and name the reason — unless
		// the request is the rate the element already plays: that is the current
		// fact, not an unsupported change, and answering "1x" as a failure would
		// make every reset look broken on a stream that is pinned at 1x anyway.
		if (isLiveUnsupportedField(field) && isLiveMedia(element)) {
			const pinned = element.playbackRate;
			if (nativeValuesMatch(value, pinned, 0.01)) {
				this.putState(fields, field, value, pinned, intent, 'dom-native');
				return;
			}
			this.putError(
				fields,
				field,
				value,
				intent,
				'capability-unavailable',
				'A live stream has no playback rate to change',
				false,
			);
			return;
		}

		const tolerance = field === 'volumeBase' || field === 'speed'
			? 0.01
			: field === 'currentTime' ? 0.05 : 0;
		const effectiveDesired = field === 'currentTime'
			? clampNativeSeek(element, value as number)
			: value;
		let baseline: ControlValues[RestorableMediaField] | undefined;
		let controllerBaseline: number | undefined;
		let mediaWriter: RestorableMediaWriter = 'dom-native';
		let writerUpgrade: OwnedMediaField | undefined;
		let speedFallbackFrom: OwnedMediaField | null | undefined;
		let rejectedPageSpeed: number | undefined;
		if (isRestorableMediaField(field)) {
			try {
				const baselineState = readRestorableMediaFieldForWrite(element, field, effectiveDesired);
				baseline = baselineState.actual;
				controllerBaseline = baselineState.controllerBaseline;
				mediaWriter = baselineState.writer;
				writerUpgrade = baselineState.upgradeFrom;
				speedFallbackFrom = baselineState.speedFallbackFrom;
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
			expected: effectiveDesired,
			tolerance,
			timeoutId: setTimeout(() => this.expirePendingWrite(target.mediaId, field, intent.intentId), field === 'speed' ? SPEED_PENDING_BUDGET_MS : 1_000),
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
				const ownedWriter = nativeMediaOwnership.byElement.get(element)?.get(field)?.writer;
				const pageWriterAlreadyOwned = ownedWriter !== undefined && isPageSideWriter(ownedWriter);
				// Split-ack eligibility. Only the standard-DOM writer qualifies: a
				// page-controller write still has to prove its capability and may fall
				// through to the DOM writer, and that verdict is precisely what the
				// awaited path exists to produce.
				//
				// Speed stays awaited even for the DOM writer. It is a discrete set,
				// not a drag, so the settle window costs nothing the viewer can feel —
				// while answering early leaves the transaction holding a value the
				// page's own source swap can erase in the same task. Answering
				// "written" first also leaves the field in the written state, where a
				// later observation of the same element is a new fact rather than a
				// confirmation, and the returning target loses the ownership the
				// viewer's write had established.
				//
				// Fields with no native event (preservePitch, loop) keep their cheap
				// two-frame readback because deferring them would trade ~33ms for a
				// detached 750ms listener with no user-visible gain.
				const siteKey = resolveNativeWriteSiteKey();
				const canSplitAck = mediaWriter === 'dom-native'
					&& writerUpgrade === undefined
					&& field !== 'speed'
					&& !(field === 'mediaMuted' && effectiveDesired === false)
					&& resolveNativeWriteMode(siteKey) === 'optimistic';
				if (canSplitAck) {
					// The whole latency win is these lines: the setter lands and the
					// transaction answers in the same task instead of waiting out the
					// event-quiet window plus two render frames.
					const startedAt = performance.now();
					const written = writeRestorableMediaField(
						element,
						field,
						effectiveDesired as ControlValues[typeof field],
						'dom-native',
					) as ControlValues[typeof field];
					const sampleId = recordNativeWrite(field, performance.now() - startedAt);
					this.putState(fields, field, effectiveDesired, written, intent, 'dom-native', 'written');
					this.observe(target.mediaId, field, written);
					this.writeConfirmations.schedule(`${target.mediaId}:${field}`, {
						element,
						// Only the two volume fields reach this branch; speed is
						// deliberately awaited, so it can never be proven later.
						field: field as 'volumeBase' | 'mediaMuted',
						events: ['volumechange'],
						read: () => readDomRestorableMediaField(element, field as RestorableMediaField),
						desired: effectiveDesired as number | boolean,
						tolerance,
						siteKey,
						sampleId,
						startedAt,
						signal,
						isCurrent,
						// A detached proof is observation evidence, not a private cache
						// update: use the same coherent volume/mute publication path as
						// the native event, including active-target and ownership checks.
						onDrift: () => this.handleMediaEvent(target, 'volumechange', element),
					});
				} else {
					let actual: ControlValues[typeof field];
					try {
					actual = await writeRestorableMediaFieldWithStableAck(
						element,
						field,
						effectiveDesired as ControlValues[typeof field],
						mediaWriter,
						tolerance,
							{ signal, isCurrent, explicitUnmute },
					) as ControlValues[typeof field];
					assertCurrent();
				} catch (pageError) {
					assertCurrent();
					const failure = this.nativeFailure(field, pageError);
					const capabilityGap = failure.code === 'readback-mismatch'
						|| failure.code === 'write-unsupported'
						|| pageError instanceof PageMediaCapabilityUnavailableError;
					// The DOM writer physically clamps volumeBase to the standard
					// 0-100 scale, so an above-100 probe can never be honored there.
					// Skipping the DOM attempt keeps the coordinator's rejected probe
					// on one fast page-bridge readback instead of a guaranteed 750ms
					// event-ack timeout on every routing-boundary crossing.
					const domCannotScale = field === 'volumeBase'
						&& (effectiveDesired as number) > CONTROL_VALUE_LIMITS.volumeBase.max;
					const mayFallThrough = !domCannotScale
						&& isPageSideWriter(mediaWriter)
						&& capabilityGap
						&& (!pageWriterAlreadyOwned || (field === 'speed'
							&& !(pageError instanceof PageMediaCapabilityUnavailableError)))
						&& await pageCandidateRestoredBaseline(
							element,
							field,
							baseline as ControlValues[typeof field],
							pageError,
							tolerance,
							{ signal, isCurrent },
							controllerBaseline,
						);
					assertCurrent();
					if (!mayFallThrough) throw pageError;
					if (field === 'speed') {
						speedFallbackFrom = nativeMediaOwnership.byElement.get(element)?.get(field) ?? null;
						rejectedPageSpeed = effectiveDesired as number;
					}
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
					} else if (field === 'speed') {
						// The prior physical rate can itself be outside the page range.
						// Restore that separate witness through DOM before applying the
						// next value; never require the page to support an old free rate.
						if (!nativeValuesMatch(element.playbackRate, baseline, tolerance)) {
							await writeRestorableMediaFieldWithStableAck(element, field, baseline, 'dom-native', tolerance, { signal, isCurrent });
						}
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
						{ signal, isCurrent, explicitUnmute },
					) as ControlValues[typeof field];
					assertCurrent();
					}
					this.putState(fields, field, effectiveDesired, actual, intent, wireStrategy(mediaWriter), 'confirmed');
					this.observe(target.mediaId, field, actual);
					if (mediaWriter === 'declared-official' && isPageMediaField(field)) {
						this.auditDeclaredProjection(
							`${target.mediaId}:${field}:ui`,
							element,
							field,
							effectiveDesired as ControlValues[typeof field],
							siteKey,
							signal,
						);
					}
				}
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
					if (value === false) this.registry.pinPaused?.(target);
					// Playback never answers before its proof. A page is free to
					// restart what we just paused — and to swallow the `pause` event
					// while doing it — so the synchronous `paused` getter is the
					// *write*, not the acknowledgement. `writePlaybackWithStableAck`
					// races the physical setter against the stabilization window, so
					// a never-settling `play()` still cannot hold the transaction,
					// while a replay, a source swap or a lost selection all land here
					// as a real failure the viewer can see (SCTRL-005).
					const actual = await writePlaybackWithStableAck(
						element,
						value as boolean,
						{ signal, isCurrent: () => this.isSelectedTarget(target, element) },
					);
					this.assertCurrentTarget(target, element, signal, true);
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
					const enterSession = async (): Promise<void> => {
						if (document.pictureInPictureElement
							&& document.pictureInPictureElement !== element) {
							await document.exitPictureInPicture();
						}
						// Sites may set disablePictureInPicture as a UI preference. The
						// explicit extension click lifts it for this native call, and the
						// session keeps the lift: restoring it now lets the user agent run
						// the exit algorithm on the window this request just opened
						// (W3C Picture-in-Picture §3.4), which read back as a mismatch.
						const restoreDisabled = element.disablePictureInPicture;
						if (restoreDisabled) element.disablePictureInPicture = false;
						try {
							await element.requestPictureInPicture();
						} catch (error) {
							// No session was established, so the site's preference returns now.
							if (restoreDisabled) element.disablePictureInPicture = true;
							throw error;
						}
						if (restoreDisabled) holdPictureInPictureDisable(element);
					};
					const desiredPip = value as boolean;
					const startedAt = performance.now();
					let entered = false;
					try {
						if (desiredPip) {
							await enterSession();
							entered = true;
						} else if (document.pictureInPictureElement === element) {
							await document.exitPictureInPicture();
						}
					} catch (error) {
						// A request that reached a session and then failed was terminated by
						// the page, not by a readback: report the policy decision instead of
						// a generic mismatch. Lifecycle cancellations still win.
						if (desiredPip && entered && !isContentLifecycleError(error)) {
							throw new PictureInPictureVetoedError();
						}
						throw error;
					}
					assertCurrent();
					// request/exitPictureInPicture resolve only after the session state
					// changed, so the session owner *is* the acknowledgement. What the
					// page does to that session afterwards is a separate, detached fact.
					if ((document.pictureInPictureElement === element) !== desiredPip) {
						// A session that already vanished by the time our request
						// resolved was terminated by the page in the same task, not by a
						// failed readback: report the policy decision, not a mismatch.
						if (desiredPip && entered) throw new PictureInPictureVetoedError();
						throw new Error('Picture-in-Picture readback mismatch after the stable boundary');
					}
					const sampleId = recordNativeWrite(field, performance.now() - startedAt);
					this.putState(fields, field, effectiveDesired, desiredPip, intent, 'dom-native', 'written');
					this.observe(target.mediaId, field, desiredPip);
					this.writeConfirmations.schedule(`${target.mediaId}:${field}`, {
						element,
						field: 'pip',
						events: ['enterpictureinpicture', 'leavepictureinpicture'],
						read: () => document.pictureInPictureElement === element,
						desired: desiredPip,
						tolerance,
						siteKey: resolveNativeWriteSiteKey(),
						sampleId,
						startedAt,
						signal,
						isCurrent,
						// A session the page terminated is published as the observation it
						// is. The user watched the window close, so a silent correction is
						// the honest outcome; the ACK already happened.
						onDrift: () => this.handleMediaEvent(target, 'leavepictureinpicture', element),
					});
					break;
				}
				case 'fullscreen': {
					const desiredFullscreen = value as boolean;
					const requestFullscreen = async (): Promise<void> => {
						if (desiredFullscreen) await element.requestFullscreen();
						else if (fullscreenOwnsMedia(element)) await document.exitFullscreen();
					};
					const startedAt = performance.now();
					await (desiredFullscreen && this.audioRuntimeDelegate?.runFullscreenTransition
						? this.audioRuntimeDelegate.runFullscreenTransition(requestFullscreen)
						: requestFullscreen());
					assertCurrent();
					// Both request and exit resolve after the document's fullscreen
					// element changed, so ownership is the acknowledgement.
					if (fullscreenOwnsMedia(element) !== desiredFullscreen) {
						throw new Error('Fullscreen readback mismatch after the stable boundary');
					}
					const sampleId = recordNativeWrite(field, performance.now() - startedAt);
					this.putState(fields, field, effectiveDesired, desiredFullscreen, intent, 'dom-native', 'written');
					this.observe(target.mediaId, field, desiredFullscreen);
					this.writeConfirmations.schedule(`${target.mediaId}:${field}`, {
						element,
						field: 'fullscreen',
						// Chrome still emits the legacy-prefixed name on some builds.
						events: ['fullscreenchange', 'webkitfullscreenchange'],
						read: () => fullscreenOwnsMedia(element),
						desired: desiredFullscreen,
						tolerance,
						siteKey: resolveNativeWriteSiteKey(),
						sampleId,
						startedAt,
						signal,
						isCurrent,
						onDrift: () => this.handleMediaEvent(target, 'fullscreenchange', element),
					});
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
					speedFallbackFrom,
					rejectedPageSpeed,
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
						controllerBaseline,
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
		speedFallbackFrom?: OwnedMediaField | null,
		rejectedPageSpeed?: number,
	): void {
		const fields = nativeMediaOwnership.byElement.get(element)
			?? new Map<RestorableMediaField, OwnedMediaField>();
		const previous = fields.get(field);
		const validSpeedFallback = field === 'speed' && writer === 'dom-native'
			&& speedFallbackFrom !== undefined && (previous ?? null) === speedFallbackFrom;
		if (speedFallbackFrom !== undefined && !validSpeedFallback) {
			throw new Error('Speed ownership changed before the proven DOM handoff');
		}
		if (upgradeFrom && previous !== upgradeFrom) {
			throw new Error(`Restorable ${field} ownership changed during writer upgrade`);
		}
		if (previous && previous.writer !== writer) {
			const validUpgrade = previous === upgradeFrom
				&& WRITER_RANK[writer] > WRITER_RANK[previous.writer];
			if (!validUpgrade && !validSpeedFallback) {
				throw new Error(`Restorable ${field} writer changed while ownership was active`);
			}
		}
		fields.set(field, {
			baseline: previous?.baseline ?? baseline,
			lastApplied: actual as ControlValues[RestorableMediaField],
			writer,
			...(rejectedPageSpeed !== undefined ? { rejectedPageSpeed }
				: writer === 'dom-native' && previous?.rejectedPageSpeed !== undefined
					? { rejectedPageSpeed: previous.rejectedPageSpeed } : {}),
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
		controllerBaseline?: number,
	): Promise<void> {
		assertNativeOperationCurrent({ signal });
		const tolerance = field === 'volumeBase' || field === 'speed' ? 0.01 : 0;
		const current = field === 'speed' && isPageSideWriter(writer)
			? readPageMediaField(element, field)
			: readRestorableMediaField(element, field, writer);
		if (!nativeValuesMatch(current, attempted, tolerance)) return;
		if (field === 'speed' && isPageSideWriter(writer)) {
			await writeRestorableMediaFieldWithStableAck(element, field, controllerBaseline ?? baseline, writer, tolerance, { signal });
			if (!nativeValuesMatch(element.playbackRate, baseline, tolerance)) {
				await writeRestorableMediaFieldWithStableAck(element, field, baseline, 'dom-native', tolerance, { signal });
			}
			return;
		}
		writeRestorableMediaField(element, field, baseline, writer);
		await (isPageSideWriter(writer) ? stablePageReadback : stableReadback)(
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
		writeState?: ControlWriteState,
	): void {
		(fields as Record<string, unknown>)[field] = {
			desired,
			actual,
			revision: intent.baseRevision + 1,
			phase: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01) ? 'applied' : 'error',
			// Absent means "write and proof were the same act", which keeps the
			// declared contract honest for processors and CSS effects instead of
			// labelling them with a state they never passed through.
			...(writeState === undefined ? {} : { writeState }),
			strategy,
			coverage: 'active-target',
			// Each field is proved at its own boundary. A later sibling (for example
			// unmute) must not re-stamp an earlier volume write as a newer page fact.
			...(isRestorableMediaField(field) ? { mediaObservation: this.registry.captureObservation?.() } : {}),
			controlled: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01),
			intentId: intent.intentId,
			lastError: nativeValuesMatch(desired, actual, field === 'currentTime' ? 0.05 : 0.01)
				? null
				: { code: 'readback-mismatch', message: 'Actual state differs from the requested value', retryable: true },
		};
		// A write is the second moment the native route becomes a fact, and the one
		// that matters right after the user's first boost on a fresh document.
		if (field === 'volumeBase') this.reportVolumeRoute(strategy);
	}

	/**
	 * Run a native field's stabilization proof *after* the transaction already
	 * answered `written`.
	 *
	 * Why this is safe rather than merely fast:
	 * - Nothing here can fail the transaction. A rollback is reported as
	 *   `drifted`, never thrown, so the control path cannot regress.
	 * - A newer write cancels the proof of the write it supersedes, so verdicts
	 *   cannot arrive out of order and overwrite a fresher value.
	 * - A drift updates the observed actual, so every later read, snapshot and
	 *   projection reports what the page really holds instead of our wish.
	 * - The outcome feeds the per-site ledger, which demotes origins that keep
	 *   taking fields back to the historical verified path.
	 */

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

	/**
	 * Hand a declared write's UI witness to the detached confirmation registry.
	 * Detached on purpose: the control path must not wait for a render it cannot
	 * observe, and a stale badge is evidence to record, not a reason to fail a
	 * write whose playback rate is already correct.
	 */
	private auditDeclaredProjection(
		key: string,
		element: HTMLMediaElement,
		field: SpectraPageMediaField,
		desired: ControlValues[ControlField],
		siteKey: string,
		signal?: AbortSignal,
	): void {
		const adapter = resolveDeclaredSiteAdapter(field);
		const spec = adapter?.projection;
		if (!spec) return;
		this.writeConfirmations.auditProjection(key, {
			element,
			field,
			desired: desired as ControlValues[RestorableMediaField],
			tolerance: spec.tolerance,
			siteKey,
			readProjection: () => (
				readPageMediaEvidence(element, field)?.projection ?? null
			) as ControlValues[RestorableMediaField] | null,
			signal,
		});
	}

	private nativeFailure(
		field: ControlField,
		error: unknown,
	): { code: ControlStrategyFailure; message: string; retryable: boolean } {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof PictureInPictureVetoedError) {
			// The page owns the veto; retrying would only reopen and re-close a window.
			return { code: 'policy-denied', message, retryable: false };
		}
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

	// The pending-write guard owns every native event for a field until its
	// stable boundary settles (SP-70). A mismatch during that window is taken as
	// ambiguous and suppressed in handleMediaEvent, on the contract that "a real
	// page revision is always republished within one second" (see the suppression
	// comment). This expiry callback is that republish: once the guard elapses we
	// re-read the live DOM value and, if the page genuinely diverged from the
	// recorded baseline, submit it as a page-native observation so the background
	// snapshot converges. Without this the divergence was silently lost forever.
	// The 1s guard's expiry. By the time the guard elapses the DOM has settled, so
	// the write-completion `finally` and this timeout are equivalent: both delete
	// the pending entry and then reconcile. Delegating keeps a single reconcile
	// path and guarantees the suppressed page revision is republished no matter
	// which of the two fires first (the faster one cancels the other's timer).
	private expirePendingWrite(mediaId: string, field: ControlField, intentId: string): void {
		this.clearPending(mediaId, field, intentId);
	}

	// Deletes a settled pending write and republishes any page divergence that was
	// suppressed while the guard owned the field's events. This is the write-
	// completion `finally` path as well as the timeout path; by the time either
	// runs the executor's own write has resolved, so re-reading is safe. Without
	// this, a page-native change that arrived during the guard window was silently
	// lost forever (see handleMediaEvent's suppression branch).
	private clearPending(mediaId: string, field: ControlField, intentId: string): void {
		const fields = this.pending.get(mediaId);
		const pending = fields?.get(field);
		if (pending?.intentId !== intentId) return;
		clearTimeout(pending.timeoutId);
		fields?.delete(field);
		if (fields?.size === 0) this.pending.delete(mediaId);
		this.reconcileExpiredPending(mediaId, field);
	}

	private reconcileExpiredPending(mediaId: string, field: ControlField): void {
		if (this.disposed || this.tabId === null) return;
		const entry = this.registry.list().find(({ target }) => target.mediaId === mediaId)
			?? (this.registry.resolve(null)?.target.mediaId === mediaId ? this.registry.resolve(null) : null);
		if (!entry) return;
		const { target } = entry;
		let candidates: Record<string, unknown>;
		let candidateStrategies: Record<string, unknown>;
		try {
			const result = this.read({ target, fields: [field] as ControlReadRequest['fields'] });
			candidates = result.patch as Record<string, unknown>;
			candidateStrategies = result.observedStrategies as Record<string, unknown>;
		} catch {
			// The element may have detached during teardown; nothing safe to observe.
			return;
		}
		const actual = (candidates as Record<string, unknown>)[field];
		if (actual === undefined) return;
		const observed = this.observed.get(mediaId) ?? {};
		const tolerance = field === 'currentTime' ? 0.05 : (field === 'volumeBase' || field === 'speed' ? 0.01 : 0);
		// No divergence: the executor's own write settled (or the page already
		// matches the recorded baseline). Record the truth and move on.
		if (nativeValuesMatch(observed[field], actual, tolerance)) {
			this.observe(mediaId, field, actual as ControlValues[ControlField]);
			return;
		}
		// Genuine page divergence that was suppressed during the guard window.
		// Promote it to a page-native observation so the background converges.
		const strategy = (candidateStrategies as Record<string, unknown>)[field] as ControlObservationStrategies[keyof ControlObservationStrategies] | undefined;
		if (!strategy) {
			// Cannot attribute a safe observation strategy; keep the baseline honest
			// but do not report an unverifiable value upstream.
			this.observe(mediaId, field, actual as ControlValues[ControlField]);
			return;
		}
		const patch: ControlPatch = {};
		(patch as Record<string, unknown>)[field] = actual;
		const observedStrategies: ControlObservationStrategies = {};
		(observedStrategies as Record<string, unknown>)[field] = strategy;
		this.observe(mediaId, field, actual as ControlValues[ControlField]);
		this.audioRuntimeDelegate?.synchronizeNative(patch);
		this.queuePageObservation(target, patch, observedStrategies);
	}

	/**
	 * Announce the presentation kind as soon as it becomes a fact.
	 *
	 * The write path refuses `speed` from the element itself, but the card also
	 * removes the control, and that needs the fact before the viewer clicks.
	 * `duration` settles at `loadedmetadata`; a selection can move to an element
	 * whose duration is already known. Both events therefore re-check, and only a
	 * change from the last announcement for this target is published.
	 */
	private publishPresentationKind(
		target: import('@nexus/contracts').MediaTarget,
		element: HTMLMediaElement,
	): void {
		const key = this.targetKey(target);
		const selected = this.registry.resolve(null);
		// Metadata is not a selection gesture. Inactive video facts must not
		// replace a protected media/audio owner in the background snapshot.
		if (!selected || this.targetKey(selected.target) !== key) return;
		const live = isLiveMedia(element);
		const previous = this.presentationFacts.get(key);
		if (previous === live) return;
		this.presentationFacts.set(key, live);
		// On demand is the default. Announcing it would send one message per
		// element per document and tell the background nothing it does not assume.
		if (!live) return;
		void sendSpectraRequest('spectra.control.intent.submit', {
			source: 'page',
			requestedCoverage: 'active-target',
			target,
			patch: {},
			observedStrategies: {},
			mediaObservation: this.registry.captureObservation?.(),
			live: true,
		}).catch(() => undefined);
	}

	/*
	 * Intentionally no audio focus here.
	 *
	 * A one-way `previous.muted = true` on every `selected` transition has no
	 * unmute path, and `MediaRegistry.admitBetterCandidate` re-selects several
	 * times as geometry/metadata settle. On pages with more than one <video>
	 * (Huya/Douyin live rooms) that alternately silences elements and can leave
	 * the element the viewer is actually hearing muted for good — the "slider
	 * moves, no sound" failure. Pausing instead needs a resume path that does
	 * not fight `pausedSelectionKey`; it belongs in a dedicated, real-site
	 * verified change, not in the selection handler.
	 */
	private handleMediaEvent(
		target: import('@nexus/contracts').MediaTarget,
		event: MediaRegistryEvent,
		element: HTMLMediaElement,
		removalReason?: MediaRegistryRemovalReason,
	): void {
		if (event === 'removed') {
			// Only the element leaving the document cancels in-flight control
			// operations. A reused element that swaps `src`/`srcObject` is the same
			// control target: Chrome keeps its native properties, so the write can
			// finish and is revalidated against the new revision instead of failing
			// with `stale-media-source` (SP-22.3 §1).
			if (removalReason === 'detached') this.abortSourceOperations(target);
			if (this.disposed) return;
			const key = this.targetKey(target);
			this.presentationFacts.delete(key);
			this.targetScenes.delete(key);
			const pending = this.pending.get(target.mediaId);
			if (pending) {
				for (const write of pending.values()) clearTimeout(write.timeoutId);
				this.pending.delete(target.mediaId);
			}
			this.observed.delete(target.mediaId);
			this.appliedDesiredRevision.delete(key);
			this.replayPending.delete(key);
			this.clearSourceRestores(key);
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
		if (this.disposed) return;
		if (event === 'selected') {
			this.clearSourceRestores();
			// A proof belongs to this selection visit. The page may reset a retained
			// element and release its field ownership while another player is open;
			// its earlier success cannot suppress the explicit template on return.
			const key = this.targetKey(target);
			this.appliedDesiredRevision.delete(key);
			for (const attemptKey of this.automaticPageMaturationRevision.keys()) {
				if (attemptKey.startsWith(`${key}:`)) this.automaticPageMaturationRevision.delete(attemptKey);
			}
			// A route switch selects another player element in the same document
			// (`/follow` -> `/follow/live/<id>`). That element's own values are its
			// snapshot; without them the badge keeps the previous player's numbers
			// until the first native change or an explicit read.
			const publishValues = this.attachPublicationPending
				|| this.publishedSelectionElement !== null && this.publishedSelectionElement !== element;
			this.attachPublicationPending = false;
			this.publishedSelectionElement = element;
			this.publishEstablishedSelection(target, element, publishValues);
			return;
		}
		if (event === 'registered') this.primeObserved(target);
		if (event === 'loadedmetadata' || event === 'play' || event === 'loadeddata' || event === 'durationchange') {
			this.publishPresentationKind(target, element);
			this.replayDesired(target, element, true);
		}
		const resolved = this.registry.resolve(null);
		const selected = Boolean(resolved && resolved.target.frameId === target.frameId
			&& resolved.target.mediaId === target.mediaId);
		if (event === 'volumechange') this.explainVolume(target, element, selected);
		if (!selected) {
			// An SPA route can mount and start the successor player before the
			// registry moves control onto it (`/follow` -> `/follow/live/<id>`).
			// The viewer's native volume/mute gesture is physical state of a
			// presented element, so the badge has to follow it even while another
			// element still owns control. Control ownership never moves on a property
			// event, and a hidden preview is not a presentation.
			if (event !== 'volumechange' || this.registry.isPresented?.(target) !== true) return;
			const presented = this.readPresentedVolume(target);
			if (!presented) return;
			this.queuePageObservation(target, presented.patch, presented.observedStrategies);
			return;
		}
		const mediaId = target.mediaId;
		let observedFields: ControlReadRequest['fields'];
		if (event === 'volumechange') {
			observedFields = ['volumeBase', 'mediaMuted'];
		} else 		if (event === 'ratechange') {
			// preservesPitch has no native event; observe it in the rate transaction.
			observedFields = ['speed', 'preservePitch'];
		} else if (event === 'play' || event === 'pause' || event === 'ended') {
			observedFields = ['playing'];
		} else if (event === 'seeked') {
			observedFields = ['currentTime'];
		} else if (event === 'loopchange') {
			observedFields = ['loop'];
		} else if (event === 'enterpictureinpicture' || event === 'leavepictureinpicture') {
			observedFields = ['pip'];
		} else if (event === 'fullscreenchange') {
			// A fullscreen transition is the cue a page uses to switch the element it
			// presents, and the element it presents owns the volume/mute/speed the
			// viewer now hears. Re-reading the scalar pair here is what lets a
			// page-owned volume or rate survive the lifecycle instead of reporting
			// the stale pre-transition values for the rest of the session.
			observedFields = ['fullscreen', 'volumeBase', 'mediaMuted', 'speed', 'preservePitch'];
		} else return;
		const { patch: candidates, observedStrategies: candidateStrategies } = this.read({
			target, fields: observedFields,
		});

		const pending = this.pending.get(mediaId);
		const ownedSeek = event === 'seeked'
			&& consumeOwnedSeek(element, element.currentTime);
		const observed = this.observed.get(mediaId) ?? {};
		const patch: ControlPatch = {};
		const observedStrategies: ControlObservationStrategies = {};
		for (const [rawField, actual] of Object.entries(candidates)) {
			const field = rawField as ControlField;
			const write = pending?.get(field);
			if (write) {
				if (nativeValuesMatch(write.expected, actual, write.tolerance)) {
					this.observe(mediaId, field, actual as ControlValues[ControlField]);
				}
				// The executor's event/getter transaction owns every event for this
				// field until its stable boundary settles. A mismatch here is not
				// proof of a page bounce: a DOM-channel write is observed through the
				// page bridge, so the two channels legitimately disagree for up to the
				// 1s guard (SP-70 keeps this suppression deliberately for that reason).
				// Suppression is bounded by that guard, so a real page revision is
				// always republished within one second.
				continue;
			}
			if (field === 'currentTime' && ownedSeek) {
				this.observe(mediaId, field, actual as ControlValues[ControlField]);
				continue;
			}
			if (nativeValuesMatch(observed[field], actual, field === 'currentTime' ? 0.05 : 0.01)) continue;
			this.observe(mediaId, field, actual as ControlValues[ControlField]);
			(patch as Record<string, unknown>)[field] = actual;
			const strategy = candidateStrategies[field as keyof ControlObservationStrategies];
			if (!strategy) throw new Error(`Native observation strategy is missing for ${field}`);
			observedStrategies[field as keyof ControlObservationStrategies] = strategy;
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
				// Page takeover cancels this visit's unfinished field only. Keep the
				// document template for a future source/selection visit.
				const restore = this.sourceRestores.get(this.targetKey(target));
				if (restore) delete restore.remaining[field];
				const ownership = nativeMediaOwnership.byElement.get(element);
				ownership?.delete(field);
				if (ownership?.size === 0) nativeMediaOwnership.byElement.delete(element);
				// Page observations are per media/source actual state. They never become
				// a document-wide desired template replayed onto later media elements.
			}
		}
		this.queuePageObservation(target, patch, observedStrategies);
	}

	// Bounded field trace for the "the page's native volume never reaches the
	// badge" report (SP-22.3 §22.3). Eight lines per document separate an
	// unregistered player from a dropped observation, and the cap keeps a page
	// that writes volume in a loop from flooding the console.
	private volumeDiagnostics = 8;

	private explainVolume(target: MediaTarget, element: HTMLMediaElement, selected: boolean): void {
		if (this.volumeDiagnostics <= 0) return;
		this.volumeDiagnostics -= 1;
		const rect = element.getBoundingClientRect();
		// `console.warn` survives the production bundle (the build drops
		// `console.info`), so the trace is available in the extension the user runs.
		console.warn('[SPECTRA][volume]', {
			media: `${target.frameId}:${target.mediaId}`,
			selected,
			presented: selected || this.registry.isPresented?.(target) === true,
			paused: element.paused,
			muted: element.muted,
			volume: element.volume,
			duration: element.duration,
			buffered: element.buffered?.length ?? 0,
			rect: [Math.round(rect.width), Math.round(rect.height)],
		});
	}

	/**
	 * Read the physical volume/mute of a presented element that another element
	 * still owns. The audio runtime delegate describes the control owner, so an
	 * unselected successor is read from its own element: an SPA live route must
	 * reach the badge without moving control ownership.
	 */
	private readPresentedVolume(
		target: MediaTarget,
	): {
		patch: ControlPatch;
		observedStrategies: ControlObservationStrategies;
		mediaObservation?: ControlReadResult['mediaObservation'];
	} | null {
		const resolved = this.registry.resolve(target);
		if (!resolved) return null;
		const patch: ControlPatch = {};
		const observedStrategies: ControlObservationStrategies = {};
		for (const field of ['volumeBase', 'mediaMuted'] as const) {
			const observed = readRestorableMediaFieldWithWriter(resolved.element, field);
			(patch as Record<string, unknown>)[field] = observed.actual;
			observedStrategies[field] = observationStrategy(observed.writer);
		}
		return {
			patch,
			observedStrategies,
			...(this.registry.captureObservation
				? { mediaObservation: this.registry.captureObservation() }
				: {}),
		};
	}

	/**
	 * Publish a page-native observation.
	 *
	 * A single page gesture changes several fields and dispatches one native
	 * event per field (`volumechange` then `ratechange`), so publishing each
	 * event's divergence as its own intent made the second commit race the
	 * first: both transactions read the same snapshot revision, and the loser
	 * was rejected as stale and dropped on the floor, leaving the card painting
	 * the previous value indefinitely. Coalescing a page transaction's fields
	 * into one commit makes the observation atomic and removes that race.
	 */
	private queuePageObservation(
		target: import('@nexus/contracts').MediaTarget,
		patch: ControlPatch,
		observedStrategies: ControlObservationStrategies,
	): void {
		const key = this.targetKey(target);
		const queued = this.pageObservations.get(key);
		if (queued) {
			Object.assign(queued.patch, patch);
			Object.assign(queued.observedStrategies, observedStrategies);
		} else {
			this.pageObservations.set(key, {
				target,
				patch: { ...patch },
				observedStrategies: { ...observedStrategies },
			});
		}
		if (this.pageObservationFlushQueued) return;
		this.pageObservationFlushQueued = true;
		queueMicrotask(() => {
			this.pageObservationFlushQueued = false;
			this.flushPageObservations();
		});
	}

	private flushPageObservations(): void {
		if (this.disposed) {
			this.pageObservations.clear();
			return;
		}
		const entries = [...this.pageObservations.values()];
		this.pageObservations.clear();
		for (const { target, patch, observedStrategies } of entries) {
			const selected = this.registry.resolve(null);
			const sameTarget = Boolean(selected && selected.target.frameId === target.frameId
				&& this.targetKey(selected.target) === this.targetKey(target));
			if (!sameTarget && this.registry.isPresented?.(target) !== true) continue;
			// Queueing is not a sample. Read this batch again in one synchronous
			// turn so the stamp cannot make an older queued value look newer.
			const current = sameTarget
				? this.read({ target, fields: Object.keys(patch) as ControlReadRequest['fields'] })
				: this.readPresentedVolume(target);
			if (!current || Object.keys(current.patch).length === 0) continue;
			const live = 'live' in current && typeof current.live === 'boolean' ? current.live : undefined;
			// Observation starts with this document's registry, before any control
			// request binds this.tabId. Background derives the tab from Chrome's
			// sender and validates this exact target/document, as for lean bootstrap.
			void sendSpectraRequest('spectra.control.intent.submit', {
				source: 'page',
				requestedCoverage: 'active-target',
				target,
				patch: current.patch,
				observedStrategies: { ...observedStrategies, ...current.observedStrategies },
				mediaObservation: current.mediaObservation,
				...(typeof live === 'boolean' ? { live } : {}),
			}).catch(() => undefined);
		}
	}

	private rememberDesired(field: RestorableMediaField, value: ControlValues[ControlField]): void {
		this.mediaIntentReleased = false;
		if (nativeValuesMatch((this.desiredMedia as Record<string, unknown>)[field], value, 0.001)) return;
		(this.desiredMedia as Record<string, unknown>)[field] = value;
		this.desiredRevision += 1;
		// A successful explicit change retires this field, not another field's
		// unfinished restore. Rebind the remaining obligation to the new revision.
		for (const [key, restore] of this.sourceRestores) {
			if (restore.timer !== undefined) clearTimeout(restore.timer);
			const remaining = { ...restore.remaining };
			delete remaining[field];
			this.sourceRestores.set(key, { revision: this.desiredRevision, visit: restore.visit, remaining, attempts: 0 });
		}
	}

	private clearSourceRestores(onlyKey?: string): void {
		for (const [key, restore] of this.sourceRestores) {
			if (onlyKey !== undefined && key !== onlyKey) continue;
			if (restore.timer !== undefined) clearTimeout(restore.timer);
			this.sourceRestores.delete(key);
		}
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
				await (isPageSideWriter(owned.writer) ? stablePageReadback : stableReadback)(
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
		if (this.disposed || this.mediaIntentReleased || this.tabId === null || Object.keys(this.desiredMedia).length === 0) return;
		const selected = this.registry.resolve(null);
		if (!selected || this.targetKey(selected.target) !== this.targetKey(target)) return;
		const key = this.targetKey(target);
		if (this.replayPending.has(key)) {
			if (allowPageMaturation && element) {
				this.pageMaturationRequested.set(key, { target, element });
			}
			return;
		}
		const revision = this.desiredRevision;
		const selectionRevision = this.selectionRevision;
		const scene = this.sceneFor(target, selected.element);
		const alreadyApplied = (this.appliedDesiredRevision.get(key) ?? -1) >= revision;
		let patch: ControlPatch = { ...this.desiredMedia };
		if (scene.speed !== undefined) patch.speed = scene.speed;
		let restore = this.sourceRestores.get(key);
		if (restore && (restore.revision !== revision || restore.visit !== selectionRevision)) {
			this.clearSourceRestores(key);
			restore = undefined;
		}
		if (!restore && !alreadyApplied) {
			restore = { revision, visit: selectionRevision, remaining: patch, attempts: 0 };
			this.sourceRestores.set(key, restore);
		}
		if (restore?.timer !== undefined) {
			clearTimeout(restore.timer);
			delete restore.timer;
		}
		if (restore) patch = { ...restore.remaining };
		const automaticFields: SpectraPageMediaField[] = [];
		if (alreadyApplied && (!restore || Object.keys(restore.remaining).length === 0)) {
			if (!allowPageMaturation || !element) return;
			patch = {};
			const ownership = nativeMediaOwnership.byElement.get(element);
			for (const field of SPECTRA_PAGE_MEDIA_FIELDS) {
				const attemptKey = `${key}:${field}`;
				const desired = field === 'speed' ? scene.speed ?? this.desiredMedia.speed : this.desiredMedia[field];
				if (desired === undefined
					|| this.pending.get(target.mediaId)?.has(field)
					|| (this.automaticPageMaturationRevision.get(attemptKey) ?? -1) >= revision) {
					continue;
				}
			const owned = ownership?.get(field);
			// The auto-replay (replayDesired) only pre-empts a source swap that the
			// extension itself caused. Never let it fight a page/user gesture: if we
			// no longer own this field, or the page already moved it, the divergence
			// is reality and must be republished rather than overwritten.
			if (!owned) continue;
			const domOwned = owned.writer === 'dom-native';
			// A source swap resets the media's rate with no event and leaves a
			// declared controller still rendering the requested value, so the
			// ownership record cannot reveal that the media fell behind. Compare
			// the media itself: a viewer who sees 1.5x and hears 1.0x has a bug
			// whether or not the panel agrees with the request.
			const mediaDrift = field === 'speed'
				&& !nativeValuesMatch(
					desired,
					readDomRestorableMediaField(element, field),
					0.01,
				);
			if (field === 'speed' && !mediaDrift) {
				const admission = declaredPageSpeedAdmission(element, desired as number);
				if (admission === false || desired === owned.rejectedPageSpeed) continue;
			}
			if (!domOwned && !mediaDrift) continue;
			// The lower-level page write exists to let a later declared controller
			// take over a value that was written to the DOM. A media drift needs
			// whichever writer is authoritative now, which may be the DOM itself.
			if (!mediaDrift) {
				try {
					if (readPageMediaField(element, field) === null) continue;
				} catch {
					continue;
				}
			}
				(patch as Record<string, unknown>)[field] = desired;
				automaticFields.push(field);
			}
			if (automaticFields.length === 0) return;
		}
		if (patch.mediaMuted === false && requiresUnmuteActivation(selected.element, false)) delete patch.mediaMuted;
		if (Object.keys(patch).length === 0) return;
		this.replayPending.add(key);
		let retrySource = false;
		void sendSpectraRequest('spectra.control.intent.submit', {
			tabId: this.tabId,
			source: 'restore',
			requestedCoverage: 'active-target',
			target,
			patch,
			mediaRestore: { revision, scene: scene.id, visit: selectionRevision },
		}).then((response) => {
			if (this.disposed || revision !== this.desiredRevision || this.mediaIntentReleased) return;
			if (selectionRevision !== this.selectionRevision) return;
			if (!this.isCurrentTarget(target, element)) return;
			if (!response.ok) {
				retrySource = response.error.code === 'stale-media-source' || response.error.code === 'control_stale_revision';
				if (!retrySource && restore) restore.remaining = {};
				return;
			}
			if (restore) {
				for (const field of Object.keys(patch) as ControlField[]) {
					const state = response.data.fields[field];
					if (state?.lastError?.code === 'stale-media-source') retrySource = true;
					else if (isRestorableMediaField(field)) delete restore.remaining[field];
				}
			}
			const applied = Object.values(response.data.fields)
				.every((field) => field?.phase === 'applied');
			if (applied) this.appliedDesiredRevision.set(key, revision);
			for (const field of automaticFields) {
				this.automaticPageMaturationRevision.set(`${key}:${field}`, revision);
			}
		}).catch(() => undefined).finally(() => {
			this.replayPending.delete(key);
			if (this.disposed || this.mediaIntentReleased) return;
			const requested = this.pageMaturationRequested.get(key);
			if (requested) {
				this.pageMaturationRequested.delete(key);
				this.replayDesired(requested.target, requested.element, true);
				return;
			}
			if (revision !== this.desiredRevision || selectionRevision !== this.selectionRevision
				|| !this.isCurrentTarget(target, element)) return;
			if (!retrySource || !restore || this.sourceRestores.get(key) !== restore
				|| Object.keys(restore.remaining).length === 0) return;
			const delay = SOURCE_RESTORE_RETRY_DELAYS_MS[restore.attempts++];
			if (delay === undefined) return;
			restore.timer = setTimeout(() => {
				if (this.sourceRestores.get(key) !== restore) return;
				delete restore.timer;
				this.replayDesired(target, element, true);
			}, delay);
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
		// Detached proofs own element listeners; leaving them behind would keep
		// reading a document the executor no longer serves.
		this.writeConfirmations.abortAll();
		this.observed.clear();
		this.appliedDesiredRevision.clear();
		this.replayPending.clear();
		this.clearSourceRestores();
		this.automaticPageMaturationRevision.clear();
		this.pageMaturationRequested.clear();
		this.scenes.clear();
		this.targetScenes.clear();
		this.unsubscribeRegistry();
		this.volumeRouteReporter = null;
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
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Native control execution is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)
			|| (message.type !== 'spectra.control.intent.execute'
				&& message.type !== 'spectra.control.actual.read'
				&& message.type !== 'spectra.control.page.scale.probe')) {
			const reqType = (message as { type?: unknown })?.type;
			sendResponse(rpcFailure('invalid_request', `Malformed native control intent for ${String(reqType)}`));
			return false;
		}
		const operation: Promise<ControlApplyAck | ControlReadResult | { supported: boolean }> = Promise.resolve().then(async () => {
			executor.bindRequestContext(message.tabId, message.documentId);
			if (message.type === 'spectra.control.actual.read') {
				return executor.read(message.payload);
			}
			if (message.type === 'spectra.control.page.scale.probe') {
				return executor.probePageScale();
			}
			return await executor.execute(message.payload);
		});
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
