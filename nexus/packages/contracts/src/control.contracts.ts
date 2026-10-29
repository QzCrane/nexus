// goal: authoritative, per-field control protocol shared by every SPECTRA surface

import {
	resolveAudioVolumeState,
	type AudioSessionPhase,
	type AudioVolumeState,
	type SpectraAudioMode,
} from './audio.contracts.js';
import {
	CONTROL_VALUE_LIMITS,
	compileEffectiveVolume,
	isFiniteControlValue,
} from './control-value-limits.js';
export { compileEffectiveVolume, splitEffectiveVolume } from './control-value-limits.js';
import {
	isCaptureAdmission,
	type CaptureAdmission,
} from './capture-admission.contracts.js';
import { keySetOf } from './key-set.js';

export const CONTROL_STRATEGIES = [
	'observe',
	'capture-observe',
	'page-native',
	'dom-native',
	'chrome-native',
	'extension-state',
	'extension-css',
	'extension-overlay',
	'media-webaudio',
	'capture',
	'unsupported',
] as const;

export type ControlStrategy = (typeof CONTROL_STRATEGIES)[number];
export type ControlStrategyClass = 'observe' | 'native' | 'augmentation' | 'unsupported';
export type ControlInterceptionKind =
	| 'none'
	| 'reversible-extension-layer'
	| 'irreversible-media-source-binding'
	| 'authorized-tab-stream';
export type ControlAdmissionEvidence =
	| 'none'
	| 'existing-runtime-state'
	| 'page-controller-readback'
	| 'standard-api-readback'
	| 'chrome-api-readback'
	| 'extension-owner-readback'
	| 'computed-style-readback'
	| 'overlay-geometry-readback'
	| 'proven-media-source-eligibility'
	| 'authorized-capture-readback';
export type ControlWriterOwner =
	| 'none'
	| 'page-media-controller'
	| 'standard-dom-api'
	| 'chrome-api'
	| 'extension-state'
	| 'extension-style'
	| 'extension-overlay'
	| 'media-processor'
	| 'capture-processor';
export type ControlAudioRuntimeCost = 'none' | 'lazy-audio-context' | 'lazy-offscreen-capture';
export type ControlMainWorldPolicy = 'forbidden' | 'exact-element-page-bridge';

export interface ControlStrategyRule {
	class: ControlStrategyClass;
	writerOwner: ControlWriterOwner;
	interception: ControlInterceptionKind;
	admissionEvidence: ControlAdmissionEvidence;
	requiresExplicitIntent: boolean;
	requiresActualReadback: boolean;
	requiresDisposer: boolean;
	mainWorld: ControlMainWorldPolicy;
	audioRuntimeCost: ControlAudioRuntimeCost;
	canBypassUserActivation: false;
	canBypassCorsOrDrm: false;
}

// A failed native attempt may enter a more invasive strategy only when the
// failure proves that the capability itself is incomplete. Permission,
// activation, protected-content and identity boundaries are terminal: MAIN or
// Capture must never be used to disguise them as a successful fallback.
export const CONTROL_RETRYABLE_STRATEGY_FAILURES = [
	'capability-unavailable',
	'write-unsupported',
	'readback-mismatch',
	'coverage-incomplete',
	'strategy-runtime-failed',
] as const;

export const CONTROL_TERMINAL_STRATEGY_FAILURES = [
	'user-activation-required',
	'permission-denied',
	'cors-or-drm-protected',
	'protected-content',
	'closed-shadow-inaccessible',
	'stale-document',
	'stale-media-source',
	'policy-denied',
] as const;

export type ControlRetryableStrategyFailure =
	(typeof CONTROL_RETRYABLE_STRATEGY_FAILURES)[number];
export type ControlTerminalStrategyFailure =
	(typeof CONTROL_TERMINAL_STRATEGY_FAILURES)[number];
export type ControlStrategyFailure =
	| ControlRetryableStrategyFailure
	| ControlTerminalStrategyFailure;

const retryableStrategyFailures: ReadonlySet<string> =
	new Set(CONTROL_RETRYABLE_STRATEGY_FAILURES);

const controlStrategyFailures: ReadonlySet<string> = new Set([
	...CONTROL_RETRYABLE_STRATEGY_FAILURES,
	...CONTROL_TERMINAL_STRATEGY_FAILURES,
]);

export function isControlStrategyFailure(value: unknown): value is ControlStrategyFailure {
	return typeof value === 'string' && controlStrategyFailures.has(value);
}

export function shouldTryNextControlStrategy(failure: ControlStrategyFailure): boolean {
	return retryableStrategyFailures.has(failure);
}
export type ControlCoverage = 'full' | 'active-target' | 'partial' | 'opaque';
export type ControlRequestedCoverage = Extract<ControlCoverage, 'full' | 'active-target'>;
export type ControlFieldPhase = 'idle' | 'applied' | 'error';
/**
 * Physical write and verified stability are two different facts, reported
 * separately so a control transaction no longer has to *await* the
 * stabilization boundary before it can answer.
 *
 * `phase` keeps its original meaning (the readback verdict for the value that
 * was written). `writeState` is deliberately named this way and never reuses the
 * word `applied`, because `phase: 'applied'` already exists with a different
 * meaning and reusing it would create a contract-level double meaning.
 *
 * - `written`: the setter was invoked and the element reflects the request right
 *   now. Nothing has been proven about whether the page will keep it.
 * - `confirmed`: the value still holds past the event-quiet window and two
 *   render boundaries, i.e. the page did not roll it back.
 * - `drifted`: the page restored a different value after our write. This is the
 *   signal the stabilization window exists to produce, now surfaced instead of
 *   being spent as latency.
 * - `unconfirmed`: stabilization could not conclude (lifecycle abort, DRM/EME
 *   media that never fires the event, timeout). Explicitly *not* a failure: no
 *   error is reported and no compensation runs.
 */
export type ControlWriteState = 'written' | 'confirmed' | 'drifted' | 'unconfirmed';
/**
 * A `drifted` result is a correction, not a success and not a hard error: the
 * write physically happened and the page then took the field back.
 */
export function isControlWriteDrift(state: ControlWriteState | undefined): boolean {
	return state === 'drifted';
}
/**
 * Only a `confirmed` sample may be treated as durable proof. `written` is still
 * provisional and `unconfirmed` says nothing either way.
 */
export function isControlWriteSettled(state: ControlWriteState | undefined): boolean {
	return state === 'confirmed' || state === 'drifted' || state === 'unconfirmed';
}
export type ControlIntentSource = 'page' | 'popup' | 'remote' | 'hotkey' | 'restore' | 'system';
export type MediaKind = 'audio' | 'video';

export interface MediaTarget {
	frameId: number;
	documentId: string;
	mediaId: string;
	sourceRevision: number;
	kind: MediaKind;
}

export interface VideoFilterState {
	brightness: number;
	contrast: number;
	saturate: number;
	grayscale: boolean;
	invert: boolean;
}

export interface ABLoopState {
	pointA: number | null;
	pointB: number | null;
	enabled: boolean;
}

export interface ControlValues {
	audioEnabled: boolean;
	volumeBase: number;
	boost: number;
	mediaMuted: boolean;
	tabMuted: boolean;
	speed: number;
	preservePitch: boolean;
	playing: boolean;
	currentTime: number;
	loop: boolean;
	pip: boolean;
	fullscreen: boolean;
	rotation: 0 | 90 | 180 | 270;
	mirrored: boolean;
	fill: boolean;
	filterEnabled: boolean;
	filter: VideoFilterState;
	dimEnabled: boolean;
	dimOpacity: number;
	abLoop: ABLoopState;
	tabPinned: boolean;
	eqValues: number[];
	bass: boolean;
	compressor: boolean;
	mono: boolean;
	pan: number;
	delay: number;
	visualizer: boolean;
}

export type ControlField = keyof ControlValues;
// `abLoop` is committed only by the typed A/B operations and `visualizer` is
// owned only by the explicit subscription protocol. Keeping them out of the
// ordinary patch/mutation surface prevents a caller from receiving a generic
// "unsupported" ACK for an algorithm that has a different authoritative
// entry point.
export type ControlDirectField = Exclude<ControlField, 'abLoop' | 'visualizer'>;
export type ControlNativeObservationStrategy = Extract<ControlStrategy, 'page-native' | 'dom-native'>;
export type ControlNativeObservationStrategies = Partial<
	Record<ControlDirectField, ControlNativeObservationStrategy>
>;
export type ControlPatch = Partial<Pick<ControlValues, ControlDirectField>>;

// The always-on bootstrap has no MediaRegistry identity. It may therefore
// report only the two complete native field groups whose values are scoped to
// the current top-level document and are safe to restore after refresh.
export const CONTROL_BOOTSTRAP_OBSERVATION_GROUPS = [
	['volumeBase', 'mediaMuted'],
	['speed', 'preservePitch'],
] as const satisfies readonly (readonly ControlDirectField[])[];

// Read-only native facts required to compile related augmentation fields. They
// travel with an intent so a lazy audio runtime never derives Boost/DSP from a
// stale legacy config after page, Popup or remote control.
export interface ControlActualContext {
	volumeBase?: number;
	mediaMuted?: boolean;
	speed?: number;
	preservePitch?: boolean;
}

export const CONTROL_FIELDS = [
	'audioEnabled',
	'volumeBase',
	'boost',
	'mediaMuted',
	'tabMuted',
	'speed',
	'preservePitch',
	'playing',
	'currentTime',
	'loop',
	'pip',
	'fullscreen',
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
	'abLoop',
	'tabPinned',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
	'visualizer',
] as const satisfies readonly ControlField[];

export const CONTROL_DIRECT_FIELDS = [
	'audioEnabled',
	'volumeBase',
	'boost',
	'mediaMuted',
	'tabMuted',
	'speed',
	'preservePitch',
	'playing',
	'currentTime',
	'loop',
	'pip',
	'fullscreen',
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
	'tabPinned',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
] as const satisfies readonly ControlDirectField[];

// A document replacement may replay only durable configuration. Momentary
// media facts (playing/currentTime/PiP/fullscreen), source-bound A/B state and
// visualizer subscriptions belong to the old document; tab mute/pin are
// already browser-owned across a refresh. The remaining fields form the exact
// acknowledged same-tab session projection and deliberately carry no media
// target identity.
export const CONTROL_SESSION_FIELDS = [
	'audioEnabled',
	'volumeBase',
	'boost',
	'mediaMuted',
	'speed',
	'preservePitch',
	'loop',
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
] as const satisfies readonly ControlDirectField[];

export type ControlSessionField = (typeof CONTROL_SESSION_FIELDS)[number];
export type ControlSessionPatch = Partial<Pick<ControlValues, ControlSessionField>>;

// Operations are momentary algorithms. They are planned like fields but do not
// pretend to be persistent desired values in ControlSnapshot.
export const CONTROL_OPERATIONS = [
	'restore-page-settings',
	'effective-volume',
	'playback-toggle',
	'seek-relative',
	'frame-step',
	'screenshot',
	'marker-add',
	'marker-remove',
	'marker-jump',
	'marker-jump-previous',
	'marker-jump-next',
	'ab-set-a',
	'ab-set-b',
	'ab-clear',
	'ab-skip',
	'audio-reset',
	'video-effects-toggle',
	'video-effects-reset',
	'show-info',
	'open-popup',
	'open-options',
	'run-user-script',
	'open-url',
] as const;

export type ControlOperation = (typeof CONTROL_OPERATIONS)[number];
export type ControlCapability = ControlField | ControlOperation;
export const CONTROL_CAPABILITIES: readonly ControlCapability[] = [
	...CONTROL_FIELDS,
	...CONTROL_OPERATIONS,
];

export type ControlScope =
	| 'document'
	| 'tab'
	| 'requested-audio-scope'
	| 'active-media'
	| 'active-video'
	| 'media-source'
	| 'extension-ui'
	| 'sandbox';

export type ControlAlgorithmKind =
	| 'field'
	| 'compound'
	| 'state-then-native'
	| 'observation'
	| 'subscription'
	| 'browser-action'
	| 'sandbox';

export type ControlAcknowledgement =
	| 'coordinator-snapshot'
	| 'page-controller-getter'
	| 'dom-event-getter'
	| 'dom-stable-getter'
	| 'chrome-event-getter'
	| 'processor-readback'
	| 'computed-style'
	| 'overlay-readback'
	| 'subscription-state'
	| 'operation-result';

export type ControlRecurringWork =
	| 'none'
	| 'while-owned'
	| 'while-subscribed';

export interface ControlAlgorithmPolicy {
	scope: ControlScope;
	kind: ControlAlgorithmKind;
	orderedStrategies: readonly Exclude<ControlStrategy, 'unsupported'>[];
	acknowledgements: readonly ControlAcknowledgement[];
	recurringWork: ControlRecurringWork;
}

export type ControlNativePreference =
	| 'observation-only'
	| 'native-only'
	| 'hybrid-extension-native'
	| 'augmentation-only';

export type ControlAugmentationAdmission =
	| 'none'
	| 'native-incomplete'
	| 'extension-owned-capability'
	| 'explicit-full-output-only'
	| 'explicit-foreground-subscription';

export interface ControlAlgorithmAdjudication {
	nativePreference: ControlNativePreference;
	augmentationAdmission: ControlAugmentationAdmission;
}

// One compact, exhaustive owner contains all runtime dimensions. The numeric
// indexes intentionally share these dictionaries so consumers can select only
// the dimension they need (for example scope or Capture admission) without
// pulling unrelated audit values into an application bundle. The audit views
// below are derived from this owner and are not runtime authorities.
const CONTROL_STRATEGY_CLASSES = ['observe', 'native', 'augmentation', 'unsupported'] as const;
const CONTROL_STRATEGY_WRITERS = [
	'none', 'page-media-controller', 'standard-dom-api', 'chrome-api',
	'extension-state', 'extension-style', 'extension-overlay', 'capture-processor', 'media-processor',
] as const;
const CONTROL_STRATEGY_INTERCEPTIONS = [
	'none', 'reversible-extension-layer', 'authorized-tab-stream', 'irreversible-media-source-binding',
] as const;
const CONTROL_STRATEGY_EVIDENCE = [
	'none', 'existing-runtime-state', 'page-controller-readback', 'standard-api-readback',
	'chrome-api-readback', 'extension-owner-readback', 'computed-style-readback',
	'overlay-geometry-readback', 'authorized-capture-readback', 'proven-media-source-eligibility',
] as const;
const CONTROL_STRATEGY_MAIN_WORLD = ['forbidden', 'exact-element-page-bridge'] as const;
const CONTROL_STRATEGY_AUDIO_COSTS = ['none', 'lazy-offscreen-capture', 'lazy-audio-context'] as const;
const CONTROL_SCOPES = [
	'document', 'tab', 'requested-audio-scope', 'active-media', 'active-video',
	'media-source', 'extension-ui', 'sandbox',
] as const;
const CONTROL_KINDS = ['field', 'compound', 'state-then-native', 'observation', 'subscription', 'browser-action', 'sandbox'] as const;
const CONTROL_ACKNOWLEDGEMENTS = [
	'coordinator-snapshot', 'page-controller-getter', 'dom-event-getter', 'dom-stable-getter',
	'chrome-event-getter', 'processor-readback', 'computed-style', 'overlay-readback',
	'subscription-state', 'operation-result',
] as const;
const CONTROL_RECURRING_WORK = ['none', 'while-owned', 'while-subscribed'] as const;
const CONTROL_NATIVE_PREFERENCES = ['observation-only', 'native-only', 'hybrid-extension-native', 'augmentation-only'] as const;
const CONTROL_AUGMENTATION_ADMISSIONS = [
	'none', 'native-incomplete', 'extension-owned-capability',
	'explicit-full-output-only', 'explicit-foreground-subscription',
] as const;

// CONTROL_STRATEGIES is the stable wire enum and therefore also owns bit
// positions. Execution order is a separate policy: a proven page graph must
// precede the more invasive Capture observer without renumbering the wire
// strategy values.
const CONTROL_STRATEGY_SELECTION_ORDER = [
	'observe', 'page-native', 'dom-native', 'chrome-native', 'extension-state',
	'extension-css', 'extension-overlay', 'media-webaudio', 'capture-observe',
	'capture', 'unsupported',
] as const satisfies readonly ControlStrategy[];

type ControlStrategyDimension = readonly [
	classIndex: number,
	writerIndex: number,
	interceptionIndex: number,
	evidenceIndex: number,
	mainWorldIndex: number,
	audioRuntimeCostIndex: number,
	flags: number,
];

type ControlCapabilityDimension = readonly [
	scopeIndex: number,
	kindIndex: number,
	strategyMask: number,
	acknowledgementMask: number,
	recurringWorkIndex: number,
	nativePreferenceIndex: number,
	augmentationAdmissionIndex: number,
];

interface ControlDimensionIndex {
	strategies: readonly ControlStrategyDimension[];
	capabilities: readonly ControlCapabilityDimension[];
}

const CONTROL_DIMENSION_INDEX = {
	strategies: [
		[0, 0, 0, 1, 0, 0, 6],
		[0, 7, 2, 8, 0, 1, 7],
		[1, 1, 0, 2, 1, 0, 3],
		[1, 2, 0, 3, 0, 0, 3],
		[1, 3, 0, 4, 0, 0, 3],
		[2, 4, 1, 5, 0, 0, 7],
		[2, 5, 1, 6, 0, 0, 7],
		[2, 6, 1, 7, 0, 0, 7],
		[2, 8, 3, 9, 0, 2, 7],
		[2, 7, 2, 8, 0, 1, 7],
		[3, 0, 0, 0, 0, 0, 0],
	],
	capabilities: [
		[0, 1, 32, 1, 0, 3, 2],
		[2, 0, 12, 6, 0, 1, 0],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 12, 6, 0, 1, 0],
		[1, 0, 16, 16, 0, 1, 0],
		[3, 0, 12, 6, 0, 1, 0],
		[3, 0, 8, 8, 0, 1, 0],
		[3, 0, 8, 4, 0, 1, 0],
		[3, 0, 8, 4, 0, 1, 0],
		[3, 0, 8, 8, 0, 1, 0],
		[4, 0, 8, 4, 0, 1, 0],
		[4, 0, 8, 4, 0, 1, 0],
		[4, 0, 64, 64, 0, 3, 2],
		[4, 0, 64, 64, 0, 3, 2],
		[4, 0, 64, 64, 0, 3, 2],
		[4, 0, 64, 64, 0, 3, 2],
		[4, 0, 64, 64, 0, 3, 2],
		[4, 0, 128, 128, 1, 3, 2],
		[4, 0, 128, 128, 1, 3, 2],
		[5, 1, 32, 5, 1, 3, 2],
		[1, 0, 16, 16, 0, 1, 0],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 0, 768, 32, 1, 3, 3],
		[2, 4, 258, 256, 2, 0, 4],
		[0, 1, 32, 1, 0, 3, 2],
		[2, 1, 812, 38, 0, 2, 3],
		[3, 1, 8, 4, 0, 1, 0],
		[3, 1, 8, 4, 0, 1, 0],
		[4, 2, 8, 4, 0, 2, 2],
		[4, 1, 16, 512, 0, 1, 0],
		[5, 1, 32, 1, 0, 3, 2],
		[5, 1, 32, 1, 0, 3, 2],
		[5, 2, 8, 4, 0, 2, 2],
		[5, 2, 8, 4, 0, 2, 2],
		[5, 2, 8, 4, 0, 2, 2],
		[5, 1, 32, 512, 0, 3, 2],
		[5, 1, 32, 512, 0, 3, 2],
		[5, 1, 32, 512, 0, 3, 2],
		[5, 2, 8, 4, 0, 2, 2],
		[2, 1, 32, 1, 0, 3, 2],
		[4, 1, 32, 1, 0, 3, 2],
		[4, 1, 32, 1, 0, 3, 2],
		[0, 3, 1, 1, 0, 0, 0],
		[6, 5, 16, 512, 0, 1, 0],
		[6, 5, 16, 512, 0, 1, 0],
		[7, 6, 32, 512, 0, 3, 2],
		[1, 5, 16, 512, 0, 1, 0],
	],
} as const satisfies ControlDimensionIndex;

function dimensionValue<T>(values: readonly T[], index: number, label: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Invalid control ${label} index ${index}`);
	return value;
}

function controlStrategyDimension(strategy: ControlStrategy): ControlStrategyDimension {
	return dimensionValue(
		CONTROL_DIMENSION_INDEX.strategies,
		CONTROL_STRATEGIES.indexOf(strategy),
		'strategy',
	);
}

function controlCapabilityDimension(capability: ControlCapability): ControlCapabilityDimension {
	return dimensionValue(
		CONTROL_DIMENSION_INDEX.capabilities,
		CONTROL_CAPABILITIES.indexOf(capability),
		'capability',
	);
}

export function selectControlStrategyClass(strategy: ControlStrategy): ControlStrategyClass {
	const [classIndex] = controlStrategyDimension(strategy);
	return dimensionValue(CONTROL_STRATEGY_CLASSES, classIndex, 'strategy class');
}

export function selectControlStrategyRule(strategy: ControlStrategy): ControlStrategyRule {
	const [classIndex, writerIndex, interceptionIndex, evidenceIndex, mainWorldIndex, audioRuntimeCostIndex, flags] =
		controlStrategyDimension(strategy);
	return {
		class: dimensionValue(CONTROL_STRATEGY_CLASSES, classIndex, 'strategy class'),
		writerOwner: dimensionValue(CONTROL_STRATEGY_WRITERS, writerIndex, 'strategy writer'),
		interception: dimensionValue(CONTROL_STRATEGY_INTERCEPTIONS, interceptionIndex, 'strategy interception'),
		admissionEvidence: dimensionValue(CONTROL_STRATEGY_EVIDENCE, evidenceIndex, 'strategy evidence'),
		requiresExplicitIntent: (flags & 1) !== 0,
		requiresActualReadback: (flags & 2) !== 0,
		requiresDisposer: (flags & 4) !== 0,
		mainWorld: dimensionValue(CONTROL_STRATEGY_MAIN_WORLD, mainWorldIndex, 'strategy MAIN policy'),
		audioRuntimeCost: dimensionValue(CONTROL_STRATEGY_AUDIO_COSTS, audioRuntimeCostIndex, 'strategy audio cost'),
		canBypassUserActivation: false,
		canBypassCorsOrDrm: false,
	};
}

function selectControlStrategies(
	mask: number,
): readonly Exclude<ControlStrategy, 'unsupported'>[] {
	const strategies: Exclude<ControlStrategy, 'unsupported'>[] = [];
	for (const strategy of CONTROL_STRATEGY_SELECTION_ORDER) {
		const index = CONTROL_STRATEGIES.indexOf(strategy);
		if ((mask & (1 << index)) === 0) continue;
		if (strategy === 'unsupported') throw new Error('Unsupported strategy cannot be an executable candidate');
		strategies.push(strategy);
	}
	return strategies;
}

function selectControlAcknowledgements(mask: number): readonly ControlAcknowledgement[] {
	const acknowledgements: ControlAcknowledgement[] = [];
	for (let index = 0; index < CONTROL_ACKNOWLEDGEMENTS.length; index += 1) {
		if ((mask & (1 << index)) === 0) continue;
		acknowledgements.push(dimensionValue(
			CONTROL_ACKNOWLEDGEMENTS,
			index,
			'capability acknowledgement',
		));
	}
	return acknowledgements;
}

export function selectControlCapabilityScope(capability: ControlCapability): ControlScope {
	const [scopeIndex] = controlCapabilityDimension(capability);
	return dimensionValue(CONTROL_SCOPES, scopeIndex, 'capability scope');
}

export function selectControlAlgorithmPolicy(capability: ControlCapability): ControlAlgorithmPolicy {
	const [scopeIndex, kindIndex, strategyMask, acknowledgementMask, recurringWorkIndex] =
		controlCapabilityDimension(capability);
	return {
		scope: dimensionValue(CONTROL_SCOPES, scopeIndex, 'capability scope'),
		kind: dimensionValue(CONTROL_KINDS, kindIndex, 'capability kind'),
		orderedStrategies: selectControlStrategies(strategyMask),
		acknowledgements: selectControlAcknowledgements(acknowledgementMask),
		recurringWork: dimensionValue(CONTROL_RECURRING_WORK, recurringWorkIndex, 'capability recurring work'),
	};
}

export function selectControlAlgorithmAdjudication(
	capability: ControlCapability,
): ControlAlgorithmAdjudication {
	const [, , , , , nativePreferenceIndex, augmentationAdmissionIndex] =
		controlCapabilityDimension(capability);
	return {
		nativePreference: dimensionValue(
			CONTROL_NATIVE_PREFERENCES,
			nativePreferenceIndex,
			'capability native preference',
		),
		augmentationAdmission: dimensionValue(
			CONTROL_AUGMENTATION_ADMISSIONS,
			augmentationAdmissionIndex,
			'capability augmentation admission',
		),
	};
}

export function selectControlAugmentationAdmission(
	capability: ControlCapability,
): ControlAugmentationAdmission {
	const [, , , , , , augmentationAdmissionIndex] = controlCapabilityDimension(capability);
	return dimensionValue(
		CONTROL_AUGMENTATION_ADMISSIONS,
		augmentationAdmissionIndex,
		'capability augmentation admission',
	);
}

export function controlCapabilityUsesStrategy(
	capability: ControlCapability,
	strategy: ControlStrategy,
): boolean {
	const [, , strategyMask] = controlCapabilityDimension(capability);
	const strategyIndex = CONTROL_STRATEGIES.indexOf(strategy);
	return strategyIndex >= 0 && (strategyMask & (1 << strategyIndex)) !== 0;
}

export function controlCapabilityUsesAcknowledgement(
	capability: ControlCapability,
	acknowledgement: ControlAcknowledgement,
): boolean {
	const [, , , acknowledgementMask] = controlCapabilityDimension(capability);
	const acknowledgementIndex = CONTROL_ACKNOWLEDGEMENTS.indexOf(acknowledgement);
	return acknowledgementIndex >= 0 && (acknowledgementMask & (1 << acknowledgementIndex)) !== 0;
}

function projectControlRecord<K extends string, V>(
	keys: readonly K[],
	project: (key: K) => V,
): Record<K, V> {
	const record = {} as Record<K, V>;
	for (const key of keys) record[key] = project(key);
	return record;
}

// These complete objects are compatibility/audit projections only. Runtime
// consumers must use the selectors above so esbuild can drop unused metadata.
export const CONTROL_STRATEGY_RULES = /* @__PURE__ */ projectControlRecord(
	CONTROL_STRATEGIES,
	selectControlStrategyRule,
);
export const CONTROL_ALGORITHM_POLICIES = /* @__PURE__ */ projectControlRecord(
	CONTROL_CAPABILITIES,
	selectControlAlgorithmPolicy,
);
export const CONTROL_ALGORITHM_ADJUDICATIONS = /* @__PURE__ */ projectControlRecord(
	CONTROL_CAPABILITIES,
	selectControlAlgorithmAdjudication,
);

export interface ControlError {
	code: string;
	message: string;
	retryable: boolean;
}

export interface ControlFieldState<T> {
	desired: T | null;
	actual: T | null;
	// Captured before a restorable writer attempt so a failed transaction can
	// compensate through the same page-controller or standard-DOM writer.
	restoreBaseline?: T;
	revision: number;
	phase: ControlFieldPhase;
	/**
	 * Split-ack provenance for native fields. Absent on processors and on any
	 * field whose write and its confirmation are the same synchronous act (CSS
	 * effects, capture gain), where `phase` alone already tells the whole story.
	 */
	writeState?: ControlWriteState;
	strategy: ControlStrategy;
	coverage: ControlCoverage;
	controlled: boolean;
	intentId?: string;
	lastError: ControlError | null;
}

export type ControlFieldStates = {
	[K in ControlField]?: ControlFieldState<ControlValues[K]>;
};

export interface ControlAudioVolumeProjection {
	effectiveVolume: number;
	volumeState: AudioVolumeState;
}

// Processor field ACKs are the transaction-local lifecycle proof consumed by
// Popup, shortcut feedback and every other projection. Thresholds never imply
// Capture, and a neutral release wins only when no active processor remains.
export function resolveAcknowledgedProcessorLifecycle(
	fields: ControlFieldStates,
): { actualMode: SpectraAudioMode; phase: AudioSessionPhase } | null {
	const processorStates = Object.entries(fields)
		.flatMap(([field, state]) => {
			if (state === undefined) return [];
			return controlCapabilityUsesAcknowledgement(
				field as ControlField,
				'processor-readback',
			) ? [state] : [];
		});
	const revision = processorStates.reduce(
		(latest, field) => Math.max(latest, field.revision),
		-1,
	);
	const latest = processorStates.filter((field) => field.revision === revision);
	if (latest.some((field) => (
		field.phase === 'applied' && field.strategy === 'capture'
	))) return { actualMode: 'capture', phase: 'active' };
	if (latest.some((field) => (
		field.phase === 'applied' && field.strategy === 'media-webaudio'
	))) return { actualMode: 'webaudio', phase: 'active' };
	if (latest.some((field) => (
		(field.phase === 'applied' || field.phase === 'idle')
		&& field.strategy === 'observe'
		&& !field.controlled
	))) return { actualMode: 'bypass', phase: 'idle' };
	return null;
}

export function resolveAcknowledgedAudioVolumeState(
	fields: ControlFieldStates,
	effectiveVolume: number,
	muted: boolean,
): AudioVolumeState {
	const lifecycle = resolveAcknowledgedProcessorLifecycle(fields);
	return resolveAudioVolumeState({
		volume: effectiveVolume,
		muted,
		actualMode: lifecycle?.actualMode ?? 'bypass',
		phase: lifecycle?.phase ?? 'idle',
	});
}

export function resolveControlAudioVolume(
	fields: ControlFieldStates,
): ControlAudioVolumeProjection | null {
	const volumeBase = fields.volumeBase?.actual;
	const boost = fields.boost?.actual;
	const mediaMuted = fields.mediaMuted?.actual;
	if (typeof volumeBase !== 'number'
		|| typeof boost !== 'number'
		|| typeof mediaMuted !== 'boolean') return null;
	const effectiveVolume = compileEffectiveVolume(volumeBase, boost);
	return {
		effectiveVolume,
		volumeState: resolveAcknowledgedAudioVolumeState(
			fields,
			effectiveVolume,
			mediaMuted,
		),
	};
}

export interface ControlIntent {
	intentId: string;
	tabId: number;
	documentId: string;
	generation: number;
	baseRevision: number;
	source: ControlIntentSource;
	requestedCoverage: ControlRequestedCoverage;
	target: MediaTarget | null;
	actualContext: ControlActualContext;
	patch: ControlPatch;
	// Background mints this volatile admission only for one current-tab Popup or
	// chrome.commands transaction. It is deliberately absent from
	// ControlSubmitRequest so callers cannot claim browser invocation authority.
	captureAdmission?: CaptureAdmission;
	// Retired optional v2 field: accepted for envelope compatibility only.
	// It grants no processor demand and current producers never emit it.
	processorHold?: boolean;
}

export interface ControlSubmitRequest {
	// Content-originated intents omit tabId; Background binds it to sender.tab.
	// Popup/remote/background callers must provide the explicit target tab.
	tabId?: number;
	source: Exclude<ControlIntentSource, 'system'>;
	requestedCoverage: ControlRequestedCoverage;
	target: MediaTarget | null;
	baseRevision?: number;
	patch?: ControlPatch;
	mutations?: readonly ControlMutation[];
	// Required only for source=page. Every observed patch field carries the
	// exact native getter/writer boundary that produced it; other sources must
	// not claim observation provenance.
	observedStrategies?: ControlNativeObservationStrategies;
}

export interface ControlMarker {
	id: string;
	time: number;
	label: string;
}

export interface ControlScreenshotResult {
	saved: true;
	method: 'capture-visible-tab';
	width: number;
	height: number;
}

export interface ControlFrameStepResult {
	currentTime: number;
	frameDuration: number;
	approximate: boolean;
}

export interface ControlOperationPayloadMap {
	'restore-page-settings': Record<string, never>;
	'effective-volume': { operation: 'set' | 'delta'; value: number };
	'playback-toggle': Record<string, never>;
	'seek-relative': { delta: number };
	'frame-step': { direction: -1 | 1 };
	screenshot: Record<string, never>;
	'marker-add': { label?: string };
	'marker-remove': { id: string };
	'marker-jump': { id: string };
	'marker-jump-previous': Record<string, never>;
	'marker-jump-next': Record<string, never>;
	'ab-set-a': Record<string, never>;
	'ab-set-b': Record<string, never>;
	'ab-clear': Record<string, never>;
	'ab-skip': Record<string, never>;
	'audio-reset': Record<string, never>;
	'video-effects-toggle': Record<string, never>;
	'video-effects-reset': Record<string, never>;
	'show-info': Record<string, never>;
	'open-popup': Record<string, never>;
	'open-options': Record<string, never>;
	'run-user-script': { script: string };
	'open-url': { url: string };
}

export interface ControlOperationResultMap {
	'restore-page-settings': { releasedFields: ControlField[] };
	'effective-volume': { effectiveVolume: number; volumeBase: number; boost: number };
	'playback-toggle': { playing: boolean };
	'seek-relative': { currentTime: number };
	'frame-step': ControlFrameStepResult;
	screenshot: ControlScreenshotResult;
	'marker-add': { marker: ControlMarker | null; remaining: number };
	'marker-remove': { removed: boolean; remaining: number };
	'marker-jump': { jumped: boolean; time: number };
	'marker-jump-previous': { jumped: boolean; actualTime: number | null; marker: ControlMarker | null };
	'marker-jump-next': { jumped: boolean; actualTime: number | null; marker: ControlMarker | null };
	'ab-set-a': { abLoop: ABLoopState };
	'ab-set-b': { abLoop: ABLoopState };
	'ab-clear': { abLoop: ABLoopState; cleared: boolean };
	'ab-skip': { abLoop: ABLoopState; skipped: boolean; currentTime: number | null };
	'audio-reset': { reset: true };
	'video-effects-toggle': { enabled: boolean };
	'video-effects-reset': { reset: true };
	'show-info': { shown: boolean };
	'open-popup': { opened: true };
	'open-options': { opened: true };
	'run-user-script': { executed: true };
	'open-url': { opened: true };
}

export type ControlOperationPayload<O extends ControlOperation> =
	ControlOperationPayloadMap[O];
export type ControlOperationResult<O extends ControlOperation> =
	ControlOperationResultMap[O];

export type ControlOperationRequest<O extends ControlOperation = ControlOperation> = {
	[K in O]: {
		tabId?: number;
		source: Exclude<ControlIntentSource, 'page' | 'system'>;
		target: MediaTarget | null;
		baseRevision?: number;
		operation: K;
		payload: ControlOperationPayloadMap[K];
	};
}[O];

export type ControlOperationIntent<O extends ControlOperation = ControlOperation> = {
	[K in O]: {
		operationId: string;
		tabId: number;
		documentId: string;
		generation: number;
		baseRevision: number;
		source: Exclude<ControlIntentSource, 'page' | 'system'>;
		target: MediaTarget | null;
		operation: K;
		payload: ControlOperationPayloadMap[K];
	};
}[O];

export type ControlOperationAck<O extends ControlOperation = ControlOperation> = {
	[K in O]: {
		operationId: string;
		tabId: number;
		documentId: string;
		generation: number;
		revision: number;
		target: MediaTarget | null;
		operation: K;
		strategy: ControlStrategy;
		coverage: ControlCoverage;
		fields: ControlFieldStates;
		audioVolume?: ControlAudioVolumeProjection;
		result: ControlOperationResultMap[K];
	};
}[O];

export type ControlMutationOperation = 'set' | 'delta' | 'toggle';

export interface ControlMutation {
	field: ControlDirectField;
	operation: ControlMutationOperation;
	value?: ControlValues[ControlField];
}

export interface ControlSnapshot {
	tabId: number;
	documentId: string;
	origin: string;
	generation: number;
	revision: number;
	activeMedia: MediaTarget | null;
	activeVideo: MediaTarget | null;
	fields: ControlFieldStates;
}

export interface ControlApplyAck {
	intentId: string;
	tabId: number;
	documentId: string;
	generation: number;
	revision: number;
	target: MediaTarget | null;
	fields: ControlFieldStates;
	audioVolume?: ControlAudioVolumeProjection;
}

export interface ControlReadRequest {
	fields: readonly ControlDirectField[];
	target: MediaTarget | null;
}

export interface ControlReadResult {
	target: MediaTarget | null;
	patch: ControlPatch;
	// Native semantic fields may be read through a complete page controller or
	// the standard DOM getter. Keep that provenance with the value instead of
	// reconstructing it in Background.
	observedStrategies: ControlNativeObservationStrategies;
}

const strategySet: ReadonlySet<string> = new Set(CONTROL_STRATEGIES);
const coverageSet: ReadonlySet<string> = new Set(['full', 'active-target', 'partial', 'opaque']);
const phaseSet: ReadonlySet<string> = new Set(['idle', 'applied', 'error']);
const writeStateSet: ReadonlySet<string> = new Set(['written', 'confirmed', 'drifted', 'unconfirmed']);
const sourceSet: ReadonlySet<string> = new Set(['page', 'popup', 'remote', 'hotkey', 'restore', 'system']);
const controlFields: ReadonlySet<string> = new Set(CONTROL_FIELDS);
const controlDirectFields: ReadonlySet<string> = new Set(CONTROL_DIRECT_FIELDS);
const controlSessionFields: ReadonlySet<string> = new Set(CONTROL_SESSION_FIELDS);
const numericMutationFields: ReadonlySet<ControlField> = new Set([
	'volumeBase', 'boost', 'speed', 'currentTime', 'rotation', 'dimOpacity', 'pan', 'delay',
]);
const nativeObservationStrategies: ReadonlySet<string> = new Set(['page-native', 'dom-native']);
const pageNativeObservationFields: readonly ControlDirectField[] = [
	'volumeBase', 'mediaMuted', 'speed',
];
const bootstrapObservationFields: ReadonlySet<ControlDirectField> = new Set(
	CONTROL_BOOTSTRAP_OBSERVATION_GROUPS.flat(),
);

const intentKeys = keySetOf<ControlIntent>()([
	'intentId',
	'tabId',
	'documentId',
	'generation',
	'baseRevision',
	'source',
	'requestedCoverage',
	'target',
	'actualContext',
	'patch',
	'captureAdmission',
	'processorHold',
]);
const submitKeys = keySetOf<ControlSubmitRequest>()([
	'tabId',
	'source',
	'requestedCoverage',
	'target',
	'baseRevision',
	'patch',
	'mutations',
	'observedStrategies',
]);
const mutationKeys = keySetOf<ControlMutation>()(['field', 'operation', 'value']);
const operationRequestKeys = keySetOf<ControlOperationRequest>()([
	'tabId', 'source', 'target', 'baseRevision', 'operation', 'payload',
]);
const operationIntentKeys = keySetOf<ControlOperationIntent>()([
	'operationId', 'tabId', 'documentId', 'generation', 'baseRevision',
	'source', 'target', 'operation', 'payload',
]);
const operationAckKeys = keySetOf<ControlOperationAck<'restore-page-settings'>>()([
	'operationId', 'tabId', 'documentId', 'generation', 'revision', 'target',
	'operation', 'strategy', 'coverage', 'fields', 'audioVolume', 'result',
]);
const ackKeys = keySetOf<ControlApplyAck>()([
	'intentId',
	'tabId',
	'documentId',
	'generation',
	'revision',
	'target',
	'fields',
	'audioVolume',
]);
const readRequestKeys = keySetOf<ControlReadRequest>()(['fields', 'target']);
const readResultKeys = keySetOf<ControlReadResult>()(['target', 'patch', 'observedStrategies']);
const snapshotKeys = keySetOf<ControlSnapshot>()([
	'tabId',
	'documentId',
	'origin',
	'generation',
	'revision',
	'activeMedia',
	'activeVideo',
	'fields',
]);
const targetKeys = keySetOf<MediaTarget>()([
	'frameId',
	'documentId',
	'mediaId',
	'sourceRevision',
	'kind',
]);
const fieldStateKeys = keySetOf<ControlFieldState<unknown>>()([
	'desired',
	'actual',
	'restoreBaseline',
	'revision',
	'phase',
	// Split-ack provenance. Optional on the type, admitted here because a
	// producer that sets it and a validator that rejects it invalidates every
	// native write. `keySetOf` makes forgetting it a compile error, not a
	// production incident.
	'writeState',
	'strategy',
	'coverage',
	'controlled',
	'intentId',
	'lastError',
]);
const errorKeys = keySetOf<ControlError>()(['code', 'message', 'retryable']);
const filterKeys = keySetOf<VideoFilterState>()([
	'brightness',
	'contrast',
	'saturate',
	'grayscale',
	'invert',
]);
const actualContextKeys = keySetOf<ControlActualContext>()([
	'volumeBase', 'mediaMuted', 'speed', 'preservePitch',
]);
const abLoopKeys = keySetOf<ABLoopState>()(['pointA', 'pointB', 'enabled']);
const audioVolumeKeys = keySetOf<ControlAudioVolumeProjection>()([
	'effectiveVolume', 'volumeState',
]);
const operationSet: ReadonlySet<string> = new Set(CONTROL_OPERATIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isBoundedString(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isControlAudioVolumeProjection(
	value: unknown,
): value is ControlAudioVolumeProjection {
	return isRecord(value)
		&& hasOnlyKeys(value, audioVolumeKeys)
		&& isFiniteControlValue(value.effectiveVolume, 'volume')
		&& (value.volumeState === 'silent'
			|| value.volumeState === 'native'
			|| value.volumeState === 'capture');
}

function isCanonicalOrigin(value: unknown): value is string {
	if (!isBoundedString(value, 2048)) return false;
	try {
		const url = new URL(value);
		return url.origin !== 'null' && url.origin === value;
	} catch {
		return false;
	}
}

export function classifyControlStrategy(strategy: ControlStrategy): ControlStrategyClass {
	return selectControlStrategyClass(strategy);
}

// Cross-process ACKs must prove more than "this is a known strategy name".
// The strategy must also belong to the exact capability policy. This prevents
// a future executor (or a stale context) from reporting Capture as page volume,
// CSS as fullscreen, or extension state as a successful native operation.
export function isControlStrategyAdmittedForCapability(
	capability: ControlCapability,
	strategy: ControlStrategy,
): boolean {
	if (strategy === 'unsupported') return false;
	return controlCapabilityUsesStrategy(capability, strategy);
}

export function isControlError(value: unknown): value is ControlError {
	return isRecord(value)
		&& hasOnlyKeys(value, errorKeys)
		&& isBoundedString(value.code, 128)
		&& isBoundedString(value.message, 4096)
		&& typeof value.retryable === 'boolean';
}

export function isMediaTarget(value: unknown): value is MediaTarget {
	return isRecord(value)
		&& hasOnlyKeys(value, targetKeys)
		&& Number.isInteger(value.frameId)
		&& Number(value.frameId) >= 0
		&& isBoundedString(value.documentId, 256)
		&& isBoundedString(value.mediaId, 256)
		&& isSafeNonNegativeInteger(value.sourceRevision)
		&& (value.kind === 'audio' || value.kind === 'video');
}

function isVideoFilterState(value: unknown): value is VideoFilterState {
	return isRecord(value)
		&& hasOnlyKeys(value, filterKeys)
		&& isFiniteInRange(value.brightness, 0, 200)
		&& isFiniteInRange(value.contrast, 0, 200)
		&& isFiniteInRange(value.saturate, 0, 200)
		&& typeof value.grayscale === 'boolean'
		&& typeof value.invert === 'boolean';
}

function isNullableTime(value: unknown): value is number | null {
	return value === null || isFiniteInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isABLoopState(value: unknown): value is ABLoopState {
	if (!isRecord(value) || !hasOnlyKeys(value, abLoopKeys)) return false;
	if (!isNullableTime(value.pointA) || !isNullableTime(value.pointB) || typeof value.enabled !== 'boolean') {
		return false;
	}
	if (value.enabled) {
		return value.pointA !== null && value.pointB !== null && value.pointB > value.pointA;
	}
	return value.pointB === null || value.pointA === null || value.pointB > value.pointA;
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
	return isRecord(value) && Object.keys(value).length === 0;
}

function isControlMarker(value: unknown): value is ControlMarker {
	return isRecord(value)
		&& hasOnlyKeys(value, new Set(['id', 'time', 'label']))
		&& typeof value.id === 'string'
		&& /^m_[0-9a-f-]{36}$/iu.test(value.id)
		&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER)
		&& typeof value.label === 'string'
		&& value.label.length > 0
		&& value.label.length <= 256;
}

function isOperationPayload(operation: ControlOperation, value: unknown): boolean {
	if (operation === 'restore-page-settings') {
		return isRecord(value) && hasOnlyKeys(value, new Set());
	}
	if (operation === 'seek-relative') {
		return isRecord(value) && hasOnlyKeys(value, new Set(['delta']))
			&& isFiniteInRange(value.delta, -86_400, 86_400) && value.delta !== 0;
	}
	if (operation === 'effective-volume') {
		if (!isRecord(value) || !hasOnlyKeys(value, new Set(['operation', 'value']))
			|| (value.operation !== 'set' && value.operation !== 'delta')
			|| typeof value.value !== 'number' || !Number.isFinite(value.value)) return false;
		return value.operation === 'set'
			? isFiniteControlValue(value.value, 'volume')
			: Math.abs(value.value) <= CONTROL_VALUE_LIMITS.volume.max && value.value !== 0;
	}
	if (operation === 'frame-step') {
		return isRecord(value) && hasOnlyKeys(value, new Set(['direction']))
			&& (value.direction === -1 || value.direction === 1);
	}
	if (operation === 'marker-add') {
		return isRecord(value) && hasOnlyKeys(value, new Set(['label']))
			&& (value.label === undefined || (
				typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 256
			));
	}
	if (operation === 'marker-remove' || operation === 'marker-jump') {
		return isRecord(value) && hasOnlyKeys(value, new Set(['id']))
			&& typeof value.id === 'string' && /^m_[0-9a-f-]{36}$/iu.test(value.id);
	}
	if (operation === 'run-user-script') {
		return isRecord(value) && hasOnlyKeys(value, new Set(['script']))
			&& typeof value.script === 'string' && value.script.length > 0
			&& value.script.length <= 100_000;
	}
	if (operation === 'open-url') {
		if (!isRecord(value) || !hasOnlyKeys(value, new Set(['url']))
			|| typeof value.url !== 'string' || value.url.length > 8192) return false;
		try {
			const url = new URL(value.url);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch { return false; }
	}
	return isEmptyRecord(value);
}

function isOperationResult(operation: ControlOperation, value: unknown): boolean {
	if (!isRecord(value)) return false;
	switch (operation) {
		case 'restore-page-settings':
			return hasOnlyKeys(value, new Set(['releasedFields']))
				&& Array.isArray(value.releasedFields)
				&& value.releasedFields.every((field) => typeof field === 'string' && controlFields.has(field));
		case 'effective-volume':
			return hasOnlyKeys(value, new Set(['effectiveVolume', 'volumeBase', 'boost']))
				&& isFiniteControlValue(value.effectiveVolume, 'volume')
				&& isFiniteControlValue(value.volumeBase, 'nativeVolume')
				&& isFiniteControlValue(value.boost, 'boost')
				&& compileEffectiveVolume(value.volumeBase, value.boost) === value.effectiveVolume;
		case 'playback-toggle':
			return hasOnlyKeys(value, new Set(['playing'])) && typeof value.playing === 'boolean';
		case 'seek-relative':
			return hasOnlyKeys(value, new Set(['currentTime']))
				&& isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER);
		case 'frame-step':
			return hasOnlyKeys(value, new Set(['currentTime', 'frameDuration', 'approximate']))
				&& isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER)
				&& isFiniteInRange(value.frameDuration, 0.001, 1)
				&& typeof value.approximate === 'boolean';
		case 'screenshot':
			return hasOnlyKeys(value, new Set(['saved', 'method', 'width', 'height']))
				&& value.saved === true
				&& value.method === 'capture-visible-tab'
				&& isFiniteInRange(value.width, 1, 100_000)
				&& isFiniteInRange(value.height, 1, 100_000);
		case 'marker-add':
			return hasOnlyKeys(value, new Set(['marker', 'remaining']))
				&& (value.marker === null || isControlMarker(value.marker))
				&& isFiniteInRange(value.remaining, 0, 1_000);
		case 'marker-remove':
			return hasOnlyKeys(value, new Set(['removed', 'remaining']))
				&& typeof value.removed === 'boolean'
				&& isFiniteInRange(value.remaining, 0, 1_000);
		case 'marker-jump':
			return hasOnlyKeys(value, new Set(['jumped', 'time']))
				&& typeof value.jumped === 'boolean'
				&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER);
		case 'marker-jump-previous':
		case 'marker-jump-next':
			return hasOnlyKeys(value, new Set(['jumped', 'actualTime', 'marker']))
				&& typeof value.jumped === 'boolean'
				&& (value.actualTime === null || isFiniteInRange(value.actualTime, 0, Number.MAX_SAFE_INTEGER))
				&& (value.marker === null || isControlMarker(value.marker));
		case 'ab-set-a':
		case 'ab-set-b':
			return hasOnlyKeys(value, new Set(['abLoop'])) && isABLoopState(value.abLoop);
		case 'ab-clear':
			return hasOnlyKeys(value, new Set(['abLoop', 'cleared']))
				&& isABLoopState(value.abLoop) && typeof value.cleared === 'boolean';
		case 'ab-skip':
			return hasOnlyKeys(value, new Set(['abLoop', 'skipped', 'currentTime']))
				&& isABLoopState(value.abLoop)
				&& typeof value.skipped === 'boolean'
				&& (value.currentTime === null
					|| isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER));
		case 'audio-reset':
		case 'video-effects-reset':
			return hasOnlyKeys(value, new Set(['reset'])) && value.reset === true;
		case 'video-effects-toggle':
			return hasOnlyKeys(value, new Set(['enabled'])) && typeof value.enabled === 'boolean';
		case 'show-info':
			return hasOnlyKeys(value, new Set(['shown'])) && typeof value.shown === 'boolean';
		case 'open-popup':
		case 'open-options':
		case 'open-url':
			return hasOnlyKeys(value, new Set(['opened'])) && value.opened === true;
		case 'run-user-script':
			return hasOnlyKeys(value, new Set(['executed'])) && value.executed === true;
	}
}

function isControlValue(field: ControlField, value: unknown): boolean {
	switch (field) {
		case 'volumeBase': return isFiniteControlValue(value, 'nativeVolume');
		case 'boost': return isFiniteControlValue(value, 'boost');
		case 'speed': return isFiniteControlValue(value, 'speed');
		case 'currentTime': return isFiniteControlValue(value, 'currentTime');
		case 'rotation': return value === 0 || value === 90 || value === 180 || value === 270;
		case 'filter': return isVideoFilterState(value);
		case 'abLoop': return isABLoopState(value);
		case 'dimOpacity': return isFiniteControlValue(value, 'dimOpacity');
		case 'eqValues': return Array.isArray(value)
			&& value.length === 10
			&& value.every((item) => isFiniteControlValue(item, 'eqBand'));
		case 'pan': return isFiniteControlValue(value, 'pan');
		case 'delay': return isFiniteControlValue(value, 'delay');
		default: return typeof value === 'boolean';
	}
}

export function isControlPatch(value: unknown): value is ControlPatch {
	if (!isRecord(value) || !hasOnlyKeys(value, controlDirectFields) || Object.keys(value).length === 0) return false;
	return Object.entries(value).every(([field, item]) => isControlValue(field as ControlField, item));
}

export function isControlSessionPatch(value: unknown): value is ControlSessionPatch {
	return isControlPatch(value)
		&& Object.keys(value).every((field) => controlSessionFields.has(field));
}

// post: identifies whether a session patch carries any extension-only
// contribution. The canonical adjudication selector represents capabilities
// the page cannot provide natively (boost, audio DSP, video CSS/overlay). A
// patch that only touches native-owned fields (volume, mute, speed) does not
// constitute extension usage. `audioEnabled` alone is the master switch, not a
// contribution: only a non-default augmentation field proves the processor is
// actively reshaping output.
export function hasExtensionOnlyContribution(patch: ControlSessionPatch): boolean {
	// Audio processor DSP (authorized Capture strategy)
	if (typeof patch.boost === 'number' && patch.boost > 1) return true;
	if (Array.isArray(patch.eqValues) && patch.eqValues.some((v) => v !== 0)) return true;
	if (patch.bass === true) return true;
	if (patch.compressor === true) return true;
	if (patch.mono === true) return true;
	if (typeof patch.pan === 'number' && patch.pan !== 0) return true;
	if (typeof patch.delay === 'number' && patch.delay > 0) return true;
	// Video extension CSS (extension-css strategy)
	if (typeof patch.rotation === 'number' && patch.rotation !== 0) return true;
	if (patch.mirrored === true) return true;
	if (patch.fill === true) return true;
	if (patch.filterEnabled === true) return true;
	if (isNonDefaultFilter(patch.filter)) return true;
	// Video overlay (extension-overlay strategy)
	if (patch.dimEnabled === true) return true;
	return false;
}

function isNonDefaultFilter(filter: VideoFilterState | undefined): boolean {
	if (!filter) return false;
	return filter.brightness !== 100
		|| filter.contrast !== 100
		|| filter.saturate !== 100
		|| filter.grayscale === true
		|| filter.invert === true;
}

function isControlNativeObservationStrategies(
	value: unknown,
	patch: ControlPatch,
	requireExactPatchKeys: boolean,
): value is ControlNativeObservationStrategies {
	if (!isRecord(value) || !hasOnlyKeys(value, controlDirectFields)) return false;
	const patchKeys = Object.keys(patch);
	const strategyKeys = Object.keys(value);
	if (requireExactPatchKeys && (
		strategyKeys.length !== patchKeys.length
		|| patchKeys.some((field) => !Object.hasOwn(value, field))
	)) return false;
	return Object.entries(value).every(([rawField, rawStrategy]) => {
		if (!Object.hasOwn(patch, rawField)
			|| typeof rawStrategy !== 'string'
			|| !nativeObservationStrategies.has(rawStrategy)) return false;
		return isControlStrategyAdmittedForCapability(
			rawField as ControlDirectField,
			rawStrategy as ControlNativeObservationStrategy,
		);
	});
}

function isBootstrapNativeObservationPatch(patch: ControlPatch): boolean {
	const patchKeys = Object.keys(patch) as ControlDirectField[];
	if (patchKeys.length === 0 || patchKeys.some((field) => !bootstrapObservationFields.has(field))) {
		return false;
	}
	return CONTROL_BOOTSTRAP_OBSERVATION_GROUPS.every((group) => {
		const present = group.filter((field) => Object.hasOwn(patch, field)).length;
		return present === 0 || present === group.length;
	});
}

function isControlActualContext(value: unknown): value is ControlActualContext {
	return isRecord(value)
		&& hasOnlyKeys(value, actualContextKeys)
		&& Object.entries(value).every(([field, item]) =>
			isControlValue(field as keyof ControlActualContext, item));
}

function isControlFieldState(field: ControlField, value: unknown): boolean {
	if (!isRecord(value) || !hasOnlyKeys(value, fieldStateKeys)) return false;
	const strategy = value.strategy as ControlStrategy;
	const admittedStrategy = typeof value.strategy === 'string'
		&& strategySet.has(value.strategy)
		&& (
			isControlStrategyAdmittedForCapability(field, strategy)
			|| (strategy === 'unsupported'
				&& value.phase === 'error'
				&& value.controlled === false
				&& value.lastError !== null)
			// A neutral or disabled processor reports an observation-only release:
			// no graph owns the field, and saved desired DSP values may remain idle.
			|| (strategy === 'observe'
				&& selectControlAugmentationAdmission(field)
					=== 'explicit-full-output-only'
				&& value.controlled === false
				&& (value.phase === 'idle' || value.phase === 'applied'))
		);
	return (value.desired === null || isControlValue(field, value.desired))
		&& (value.actual === null || isControlValue(field, value.actual))
		&& (value.restoreBaseline === undefined || isControlValue(field, value.restoreBaseline))
		&& isSafeNonNegativeInteger(value.revision)
		&& typeof value.phase === 'string'
		&& phaseSet.has(value.phase)
		&& (value.writeState === undefined
			|| (typeof value.writeState === 'string' && writeStateSet.has(value.writeState)))
		&& admittedStrategy
		&& typeof value.coverage === 'string'
		&& coverageSet.has(value.coverage)
		&& typeof value.controlled === 'boolean'
		&& (value.intentId === undefined || isBoundedString(value.intentId, 128))
		&& (value.lastError === null || isControlError(value.lastError));
}

function isControlFieldStates(value: unknown): value is ControlFieldStates {
	if (!isRecord(value) || !hasOnlyKeys(value, controlFields)) return false;
	return Object.entries(value).every(([field, state]) => isControlFieldState(field as ControlField, state));
}

export function isControlIntent(value: unknown): value is ControlIntent {
	return isRecord(value)
		&& hasOnlyKeys(value, intentKeys)
		&& isBoundedString(value.intentId, 128)
		&& (value.tabId === undefined || (Number.isInteger(value.tabId) && Number(value.tabId) > 0))
		&& isBoundedString(value.documentId, 256)
		&& isSafeNonNegativeInteger(value.generation)
		&& isSafeNonNegativeInteger(value.baseRevision)
		&& typeof value.source === 'string'
		&& sourceSet.has(value.source)
		&& (value.requestedCoverage === 'active-target' || value.requestedCoverage === 'full')
		&& (value.target === null || isMediaTarget(value.target))
		&& isControlActualContext(value.actualContext)
		&& isControlPatch(value.patch)
		&& (value.captureAdmission === undefined
			|| isCaptureAdmission(value.captureAdmission));
}

export function isControlSubmitRequest(value: unknown): value is ControlSubmitRequest {
	const hasPatch = isRecord(value) && value.patch !== undefined;
	const hasMutations = isRecord(value) && value.mutations !== undefined;
	if (!isRecord(value)) return false;
	if (!hasOnlyKeys(value, submitKeys)) return false;
	const sourceIsPage = value.source === 'page';
	const observationShapeIsValid = sourceIsPage
		? value.requestedCoverage === 'active-target'
			&& hasPatch
			&& !hasMutations
			&& isControlPatch(value.patch)
			&& (value.target !== null || isBootstrapNativeObservationPatch(value.patch))
			&& isControlNativeObservationStrategies(value.observedStrategies, value.patch, true)
		: value.observedStrategies === undefined;
	return observationShapeIsValid
		&& (value.tabId === undefined || (Number.isInteger(value.tabId) && Number(value.tabId) > 0))
		&& typeof value.source === 'string'
		&& value.source !== 'system'
		&& sourceSet.has(value.source)
		&& (value.requestedCoverage === 'active-target' || value.requestedCoverage === 'full')
		&& (value.target === null || isMediaTarget(value.target))
		&& (value.baseRevision === undefined || isSafeNonNegativeInteger(value.baseRevision))
		&& (hasPatch || hasMutations)
		&& (value.patch === undefined || isControlPatch(value.patch))
		&& (value.mutations === undefined || (
			Array.isArray(value.mutations)
			&& value.mutations.length > 0
			&& value.mutations.length <= 32
			&& value.mutations.every(isControlMutation)
		));
}

export function isControlOperationRequest(value: unknown): value is ControlOperationRequest {
	return isRecord(value)
		&& hasOnlyKeys(value, operationRequestKeys)
		&& (value.tabId === undefined || (Number.isInteger(value.tabId) && Number(value.tabId) > 0))
		&& typeof value.source === 'string'
		&& value.source !== 'page'
		&& value.source !== 'system'
		&& sourceSet.has(value.source)
		&& (value.target === null || isMediaTarget(value.target))
		&& (value.baseRevision === undefined || isSafeNonNegativeInteger(value.baseRevision))
		&& typeof value.operation === 'string'
		&& operationSet.has(value.operation)
		&& isOperationPayload(value.operation as ControlOperation, value.payload);
}

export function isControlOperationIntent(value: unknown): value is ControlOperationIntent {
	return isRecord(value)
		&& hasOnlyKeys(value, operationIntentKeys)
		&& isBoundedString(value.operationId, 128)
		&& Number.isInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& isBoundedString(value.documentId, 256)
		&& isSafeNonNegativeInteger(value.generation)
		&& isSafeNonNegativeInteger(value.baseRevision)
		&& typeof value.source === 'string'
		&& value.source !== 'page'
		&& value.source !== 'system'
		&& sourceSet.has(value.source)
		&& (value.target === null || isMediaTarget(value.target))
		&& typeof value.operation === 'string'
		&& operationSet.has(value.operation)
		&& isOperationPayload(value.operation as ControlOperation, value.payload);
}

export function isControlOperationAck(value: unknown): value is ControlOperationAck {
	return isRecord(value)
		&& hasOnlyKeys(value, operationAckKeys)
		&& isBoundedString(value.operationId, 128)
		&& Number.isInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& isBoundedString(value.documentId, 256)
		&& isSafeNonNegativeInteger(value.generation)
		&& isSafeNonNegativeInteger(value.revision)
		&& (value.target === null || isMediaTarget(value.target))
		&& typeof value.operation === 'string'
		&& operationSet.has(value.operation)
		&& typeof value.strategy === 'string'
		&& strategySet.has(value.strategy)
		&& isControlStrategyAdmittedForCapability(
			value.operation as ControlOperation,
			value.strategy as ControlStrategy,
		)
		&& typeof value.coverage === 'string'
		&& coverageSet.has(value.coverage)
		&& isControlFieldStates(value.fields)
		&& (value.audioVolume === undefined
			|| isControlAudioVolumeProjection(value.audioVolume))
		&& isOperationResult(value.operation as ControlOperation, value.result);
}

function isControlMutation(value: unknown): value is ControlMutation {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, mutationKeys)
		|| typeof value.field !== 'string'
		|| !controlDirectFields.has(value.field)
		|| (value.operation !== 'set' && value.operation !== 'delta' && value.operation !== 'toggle')) {
		return false;
	}
	const field = value.field as ControlDirectField;
	if (value.operation === 'set') return isControlValue(field, value.value);
	if (value.operation === 'toggle') {
		return value.value === undefined && isControlValue(field, false);
	}
	return typeof value.value === 'number'
		&& Number.isFinite(value.value)
		&& value.value !== 0
		&& numericMutationFields.has(field);
}

export function isControlSnapshot(value: unknown): value is ControlSnapshot {
	return isRecord(value)
		&& hasOnlyKeys(value, snapshotKeys)
		&& Number.isInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& isBoundedString(value.documentId, 256)
		&& isCanonicalOrigin(value.origin)
		&& isSafeNonNegativeInteger(value.generation)
		&& isSafeNonNegativeInteger(value.revision)
		&& (value.activeMedia === null || isMediaTarget(value.activeMedia))
		&& (value.activeVideo === null
			|| isMediaTarget(value.activeVideo) && value.activeVideo.kind === 'video')
		&& isControlFieldStates(value.fields);
}

export function isControlApplyAck(value: unknown): value is ControlApplyAck {
	return isRecord(value)
		&& hasOnlyKeys(value, ackKeys)
		&& isBoundedString(value.intentId, 128)
		&& Number.isInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& isBoundedString(value.documentId, 256)
		&& isSafeNonNegativeInteger(value.generation)
		&& isSafeNonNegativeInteger(value.revision)
		&& (value.target === null || isMediaTarget(value.target))
		&& isControlFieldStates(value.fields)
		&& (value.audioVolume === undefined
			|| isControlAudioVolumeProjection(value.audioVolume));
}

/**
 * Names the first reason a payload fails the apply-ack contract.
 *
 * A boolean tells the caller "invalid" and nothing else, so a boundary can only
 * reject and log a blob. This returns the offending key path instead, which is
 * what turns a production symptom into a diagnosis. It is only ever called on
 * the failure path.
 */
export function explainControlApplyAck(value: unknown): string | null {
	if (!isRecord(value)) return 'payload is not an object';
	const unexpected = Object.keys(value).filter((key) => !ackKeys.has(key));
	if (unexpected.length > 0) return `unexpected keys: ${unexpected.join(', ')}`;
	if (!isBoundedString(value.intentId, 128)) return 'intentId is invalid';
	if (!Number.isInteger(value.tabId) || Number(value.tabId) <= 0) return 'tabId is invalid';
	if (!isBoundedString(value.documentId, 256)) return 'documentId is invalid';
	if (!isSafeNonNegativeInteger(value.generation)) return 'generation is invalid';
	if (!isSafeNonNegativeInteger(value.revision)) return 'revision is invalid';
	if (value.target !== null && !isMediaTarget(value.target)) return 'target is invalid';
	if (!isRecord(value.fields)) return 'fields is not an object';
	for (const [field, state] of Object.entries(value.fields)) {
		if (!isRecord(state)) return `fields.${field} is not an object`;
		const fieldUnexpected = Object.keys(state).filter((key) => !fieldStateKeys.has(key));
		if (fieldUnexpected.length > 0) {
			return `fields.${field} has unexpected keys: ${fieldUnexpected.join(', ')}`;
		}
		if (!isControlFieldState(field as ControlField, state)) {
			return `fields.${field} violates its field-state contract`;
		}
	}
	if (value.audioVolume !== undefined && !isControlAudioVolumeProjection(value.audioVolume)) {
		return 'audioVolume is invalid';
	}
	return isControlApplyAck(value) ? null : 'payload does not satisfy the apply-ack contract';
}

export function isControlReadRequest(value: unknown): value is ControlReadRequest {
	return isRecord(value)
		&& hasOnlyKeys(value, readRequestKeys)
		&& Array.isArray(value.fields)
		&& value.fields.length > 0
		&& value.fields.length <= CONTROL_DIRECT_FIELDS.length
		&& new Set(value.fields).size === value.fields.length
		&& value.fields.every((field) => typeof field === 'string' && controlDirectFields.has(field))
		&& (value.target === null || isMediaTarget(value.target));
}

export function isControlReadResult(value: unknown): value is ControlReadResult {
	if (!isRecord(value)) return false;
	const patch = value.patch;
	const observedStrategies = value.observedStrategies;
	if (!hasOnlyKeys(value, readResultKeys)
		|| (value.target !== null && !isMediaTarget(value.target))
		|| !isControlPatch(patch)
		|| !isControlNativeObservationStrategies(observedStrategies, patch, false)) {
		return false;
	}
	return pageNativeObservationFields.every((field) => (
		patch[field] === undefined
		|| Object.hasOwn(observedStrategies, field)
	));
}
