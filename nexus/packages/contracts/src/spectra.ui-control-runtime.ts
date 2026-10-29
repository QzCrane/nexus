// goal: focused canonical-parity control guards for extension UI bundles

import type {
	ABLoopState,
	ControlApplyAck,
	ControlAudioVolumeProjection,
	ControlError,
	ControlField,
	ControlFieldState,
	ControlFieldStates,
	ControlMarker,
	ControlOperation,
	ControlOperationAck,
	ControlOperationResultMap,
	ControlSnapshot,
	ControlStrategy,
	ControlWriteState,
	MediaTarget,
	VideoFilterState,
} from './control.contracts.js';
import { keySetOf } from './key-set.js';
import type { AudioSessionPhase, SpectraAudioMode } from './audio.contracts.js';
import { isFiniteControlValue } from './control-value-limits.js';

const STRATEGIES = new Set<ControlStrategy>([
	'observe', 'capture-observe', 'page-native', 'dom-native', 'chrome-native', 'extension-state',
	'extension-css', 'extension-overlay', 'media-webaudio', 'capture', 'unsupported',
]);
const COVERAGES = new Set(['full', 'active-target', 'partial', 'opaque']);
const PHASES = new Set(['idle', 'applied', 'error']);
const FIELD_STRATEGIES = {
	audioEnabled: ['extension-state'],
	volumeBase: ['page-native', 'dom-native'],
	boost: ['media-webaudio', 'capture'],
	mediaMuted: ['page-native', 'dom-native'],
	tabMuted: ['chrome-native'],
	speed: ['page-native', 'dom-native'],
	preservePitch: ['dom-native'],
	playing: ['dom-native'],
	currentTime: ['dom-native'],
	loop: ['dom-native'],
	pip: ['dom-native'],
	fullscreen: ['dom-native'],
	rotation: ['extension-css'],
	mirrored: ['extension-css'],
	fill: ['extension-css'],
	filterEnabled: ['extension-css'],
	filter: ['extension-css'],
	dimEnabled: ['extension-overlay'],
	dimOpacity: ['extension-overlay'],
	abLoop: ['extension-state'],
	tabPinned: ['chrome-native'],
	eqValues: ['media-webaudio', 'capture'],
	bass: ['media-webaudio', 'capture'],
	compressor: ['media-webaudio', 'capture'],
	mono: ['media-webaudio', 'capture'],
	pan: ['media-webaudio', 'capture'],
	delay: ['media-webaudio', 'capture'],
	visualizer: ['media-webaudio', 'capture-observe'],
} as const satisfies Record<ControlField, readonly ControlStrategy[]>;

// The strategy table is the canonical field inventory. Deriving these sets
// avoids maintaining a second list of the same control/processor names while
// preserving the compile-time Record<ControlField, ...> completeness check.
const CONTROL_FIELDS = new Set<ControlField>(Object.keys(FIELD_STRATEGIES) as ControlField[]);
const PROCESSOR_FIELDS = new Set<ControlField>(
	Object.entries(FIELD_STRATEGIES)
		.filter(([, strategies]) => strategies.some((strategy) => strategy === 'capture'))
		.map(([field]) => field as ControlField),
);
const OPERATION_STRATEGIES = {
	'restore-page-settings': 'extension-state',
	'effective-volume': 'extension-state',
	'playback-toggle': 'dom-native',
	'seek-relative': 'dom-native',
	'frame-step': 'dom-native',
	screenshot: 'chrome-native',
	'marker-add': 'extension-state',
	'marker-remove': 'extension-state',
	'marker-jump': 'dom-native',
	'marker-jump-previous': 'dom-native',
	'marker-jump-next': 'dom-native',
	'ab-set-a': 'extension-state',
	'ab-set-b': 'extension-state',
	'ab-clear': 'extension-state',
	'ab-skip': 'dom-native',
	'audio-reset': 'extension-state',
	'video-effects-toggle': 'extension-state',
	'video-effects-reset': 'extension-state',
	'show-info': 'observe',
	'open-popup': 'chrome-native',
	'open-options': 'chrome-native',
	'run-user-script': 'extension-state',
	'open-url': 'chrome-native',
} as const satisfies Record<ControlOperation, ControlStrategy>;
const OPERATIONS = new Set<ControlOperation>(Object.keys(OPERATION_STRATEGIES) as ControlOperation[]);

// These schemas are exercised for every control snapshot/ACK. Keep their
// fixed key sets outside the validators so polling and rapid input do not
// allocate a new Set for every field and operation result.
const WRITE_STATES = new Set<ControlWriteState>(['written', 'confirmed', 'drifted', 'unconfirmed']);
const AUDIO_VOLUME_PROJECTION_KEYS = keySetOf<ControlAudioVolumeProjection>()(['effectiveVolume', 'volumeState']);
const CONTROL_ERROR_KEYS = keySetOf<ControlError>()(['code', 'message', 'retryable']);
const MEDIA_TARGET_KEYS = keySetOf<MediaTarget>()(['frameId', 'documentId', 'mediaId', 'sourceRevision', 'kind']);
const FILTER_KEYS = keySetOf<VideoFilterState>()(['brightness', 'contrast', 'saturate', 'grayscale', 'invert']);
const AB_LOOP_KEYS = keySetOf<ABLoopState>()(['pointA', 'pointB', 'enabled']);
const CONTROL_FIELD_STATE_KEYS = keySetOf<ControlFieldState<unknown>>()([
	'desired',
	'actual',
	'restoreBaseline',
	'revision',
	'phase',
	'writeState',
	'strategy',
	'coverage',
	'controlled',
	'intentId',
	'lastError',
]);
const MARKER_KEYS = keySetOf<ControlMarker>()(['id', 'time', 'label']);
const RELEASED_FIELDS_RESULT_KEYS = keySetOf<ControlOperationResultMap['restore-page-settings']>()(['releasedFields']);
const EFFECTIVE_VOLUME_RESULT_KEYS = keySetOf<ControlOperationResultMap['effective-volume']>()(['effectiveVolume', 'volumeBase', 'boost']);
const PLAYBACK_TOGGLE_RESULT_KEYS = keySetOf<ControlOperationResultMap['playback-toggle']>()(['playing']);
const SEEK_RESULT_KEYS = keySetOf<ControlOperationResultMap['seek-relative']>()(['currentTime']);
const FRAME_STEP_RESULT_KEYS = keySetOf<ControlOperationResultMap['frame-step']>()(['currentTime', 'frameDuration', 'approximate']);
const SCREENSHOT_RESULT_KEYS = keySetOf<ControlOperationResultMap['screenshot']>()(['saved', 'method', 'width', 'height']);
const MARKER_ADD_RESULT_KEYS = keySetOf<ControlOperationResultMap['marker-add']>()(['marker', 'remaining']);
const MARKER_REMOVE_RESULT_KEYS = keySetOf<ControlOperationResultMap['marker-remove']>()(['removed', 'remaining']);
const MARKER_JUMP_RESULT_KEYS = keySetOf<ControlOperationResultMap['marker-jump']>()(['jumped', 'time']);
const MARKER_INDEX_RESULT_KEYS = keySetOf<ControlOperationResultMap['marker-jump-previous']>()(['jumped', 'actualTime', 'marker']);
const AB_SET_RESULT_KEYS = keySetOf<ControlOperationResultMap['ab-set-a']>()(['abLoop']);
const AB_CLEAR_RESULT_KEYS = keySetOf<ControlOperationResultMap['ab-clear']>()(['abLoop', 'cleared']);
const AB_SKIP_RESULT_KEYS = keySetOf<ControlOperationResultMap['ab-skip']>()(['abLoop', 'skipped', 'currentTime']);
const RESET_RESULT_KEYS = keySetOf<ControlOperationResultMap['audio-reset']>()(['reset']);
const ENABLED_RESULT_KEYS = keySetOf<ControlOperationResultMap['video-effects-toggle']>()(['enabled']);
const SHOWN_RESULT_KEYS = keySetOf<ControlOperationResultMap['show-info']>()(['shown']);
const OPENED_RESULT_KEYS = keySetOf<ControlOperationResultMap['open-popup']>()(['opened']);
const EXECUTED_RESULT_KEYS = keySetOf<ControlOperationResultMap['run-user-script']>()(['executed']);
const CONTROL_SNAPSHOT_KEYS = keySetOf<ControlSnapshot>()([
	'tabId',
	'documentId',
	'origin',
	'generation',
	'revision',
	'activeMedia',
	'activeVideo',
	'fields',
]);
const APPLY_ACK_KEYS = keySetOf<ControlApplyAck>()([
	'intentId',
	'tabId',
	'documentId',
	'generation',
	'revision',
	'target',
	'fields',
	'audioVolume',
]);
const OPERATION_ACK_KEYS = keySetOf<ControlOperationAck<ControlOperation>>()([
	'operationId',
	'tabId',
	'documentId',
	'generation',
	'revision',
	'target',
	'operation',
	'strategy',
	'coverage',
	'fields',
	'audioVolume',
	'result',
]);

// Processor lifecycle is a projection of the field ACKs, not an independent
// UI guess.  The UI facade already owns the admitted field strategies; using
// that table here keeps Popup off the full control algorithm catalog while
// retaining the same ACK/revision semantics as the canonical coordinator.
export function resolveAcknowledgedProcessorLifecycle(
	fields: ControlFieldStates,
): { actualMode: SpectraAudioMode; phase: AudioSessionPhase } | null {
	const processorStates = Object.entries(fields).flatMap(([field, state]) => {
		if (state === undefined) return [];
		const strategies = FIELD_STRATEGIES[field as ControlField] ?? [];
		return strategies.some((strategy) => strategy === 'capture') ? [state] : [];
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isInteger(value: unknown, positive = false): value is number {
	return Number.isSafeInteger(value) && Number(value) >= (positive ? 1 : 0);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isAudioVolumeProjection(value: unknown): boolean {
	return isRecord(value)
		&& hasOnly(value, AUDIO_VOLUME_PROJECTION_KEYS)
		&& isFiniteControlValue(value.effectiveVolume, 'volume')
		&& (value.volumeState === 'silent'
			|| value.volumeState === 'native'
			|| value.volumeState === 'capture');
}

function isBoundedString(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isControlError(value: unknown): boolean {
	return isRecord(value)
		&& hasOnly(value, CONTROL_ERROR_KEYS)
		&& isBoundedString(value.code, 128)
		&& isBoundedString(value.message, 4096)
		&& typeof value.retryable === 'boolean';
}

function isMediaTarget(value: unknown): value is MediaTarget {
	return isRecord(value)
		&& hasOnly(value, MEDIA_TARGET_KEYS)
		&& isInteger(value.frameId)
		&& isBoundedString(value.documentId, 256)
		&& isBoundedString(value.mediaId, 256)
		&& isInteger(value.sourceRevision)
		&& (value.kind === 'audio' || value.kind === 'video');
}

function isFilter(value: unknown): boolean {
	return isRecord(value)
		&& hasOnly(value, FILTER_KEYS)
		&& isFiniteInRange(value.brightness, 0, 200)
		&& isFiniteInRange(value.contrast, 0, 200)
		&& isFiniteInRange(value.saturate, 0, 200)
		&& typeof value.grayscale === 'boolean'
		&& typeof value.invert === 'boolean';
}

function isABLoop(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnly(value, AB_LOOP_KEYS)
		|| (value.pointA !== null && !isFiniteInRange(value.pointA, 0, Number.MAX_SAFE_INTEGER))
		|| (value.pointB !== null && !isFiniteInRange(value.pointB, 0, Number.MAX_SAFE_INTEGER))
		|| typeof value.enabled !== 'boolean') return false;
	if (value.enabled) {
		return value.pointA !== null && value.pointB !== null && value.pointB > value.pointA;
	}
	return value.pointB === null || value.pointA === null || value.pointB > value.pointA;
}

function isControlValue(field: ControlField, value: unknown): boolean {
	switch (field) {
		case 'volumeBase': return isFiniteControlValue(value, 'nativeVolume');
		case 'boost': return isFiniteControlValue(value, 'boost');
		case 'speed': return isFiniteControlValue(value, 'speed');
		case 'currentTime': return isFiniteControlValue(value, 'currentTime');
		case 'rotation': return value === 0 || value === 90 || value === 180 || value === 270;
		case 'filter': return isFilter(value);
		case 'abLoop': return isABLoop(value);
		case 'dimOpacity': return isFiniteControlValue(value, 'dimOpacity');
		case 'eqValues': return Array.isArray(value)
			&& value.length === 10
			&& value.every((item) => isFiniteControlValue(item, 'eqBand'));
		case 'pan': return isFiniteControlValue(value, 'pan');
		case 'delay': return isFiniteControlValue(value, 'delay');
		default: return typeof value === 'boolean';
	}
}

function isStrategyAdmitted(field: ControlField, value: Record<string, unknown>): boolean {
	if (typeof value.strategy !== 'string' || !STRATEGIES.has(value.strategy as ControlStrategy)) return false;
	const strategy = value.strategy as ControlStrategy;
	return FIELD_STRATEGIES[field].includes(strategy as never)
		|| strategy === 'unsupported'
			&& value.phase === 'error'
			&& value.controlled === false
			&& value.lastError !== null
		|| strategy === 'observe'
			&& PROCESSOR_FIELDS.has(field)
			&& value.controlled === false
			&& (value.phase === 'idle' || value.phase === 'applied');
}

function isControlFieldStates(value: unknown): boolean {
	if (!isRecord(value)) return false;
	for (const fieldName of Object.keys(value)) {
		if (!CONTROL_FIELDS.has(fieldName as ControlField)) return false;
		const state = value[fieldName];
		const field = fieldName as ControlField;
		if (!isRecord(state) || !hasOnly(state, CONTROL_FIELD_STATE_KEYS)) return false;
		if (!((state.desired === null || isControlValue(field, state.desired))
			&& (state.actual === null || isControlValue(field, state.actual))
			&& (state.restoreBaseline === undefined || isControlValue(field, state.restoreBaseline))
			&& isInteger(state.revision)
			&& typeof state.phase === 'string'
			&& PHASES.has(state.phase)
			&& (state.writeState === undefined || (typeof state.writeState === 'string' && WRITE_STATES.has(state.writeState as ControlWriteState)))
			&& isStrategyAdmitted(field, state)
			&& typeof state.coverage === 'string'
			&& COVERAGES.has(state.coverage)
			&& typeof state.controlled === 'boolean'
			&& (state.intentId === undefined || isBoundedString(state.intentId, 128))
			&& (state.lastError === null || state.lastError === undefined || isControlError(state.lastError)))) return false;
	}
	return true;
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

function isMarker(value: unknown): boolean {
	return isRecord(value)
		&& hasOnly(value, MARKER_KEYS)
		&& typeof value.id === 'string'
		&& /^m_[0-9a-f-]{36}$/iu.test(value.id)
		&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER)
		&& isBoundedString(value.label, 256);
}

function isOperationResult(operation: ControlOperation, value: unknown): boolean {
	if (!isRecord(value)) return false;
	switch (operation) {
		case 'restore-page-settings':
			return hasOnly(value, RELEASED_FIELDS_RESULT_KEYS)
				&& Array.isArray(value.releasedFields)
				&& value.releasedFields.every((field) => typeof field === 'string' && CONTROL_FIELDS.has(field as ControlField));
		case 'effective-volume':
			return hasOnly(value, EFFECTIVE_VOLUME_RESULT_KEYS)
				&& isFiniteControlValue(value.effectiveVolume, 'volume')
				&& isFiniteControlValue(value.volumeBase, 'nativeVolume')
				&& isFiniteControlValue(value.boost, 'boost')
				&& Math.round(value.volumeBase * value.boost * 100) / 100 === value.effectiveVolume;
		case 'playback-toggle':
			return hasOnly(value, PLAYBACK_TOGGLE_RESULT_KEYS) && typeof value.playing === 'boolean';
		case 'seek-relative':
			return hasOnly(value, SEEK_RESULT_KEYS)
				&& isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER);
		case 'frame-step':
			return hasOnly(value, FRAME_STEP_RESULT_KEYS)
				&& isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER)
				&& isFiniteInRange(value.frameDuration, 0.001, 1)
				&& typeof value.approximate === 'boolean';
		case 'screenshot':
			return hasOnly(value, SCREENSHOT_RESULT_KEYS)
				&& value.saved === true
				&& value.method === 'capture-visible-tab'
				&& isFiniteInRange(value.width, 1, 100_000)
				&& isFiniteInRange(value.height, 1, 100_000);
		case 'marker-add':
			return hasOnly(value, MARKER_ADD_RESULT_KEYS)
				&& (value.marker === null || isMarker(value.marker))
				&& isFiniteInRange(value.remaining, 0, 1_000);
		case 'marker-remove':
			return hasOnly(value, MARKER_REMOVE_RESULT_KEYS)
				&& typeof value.removed === 'boolean'
				&& isFiniteInRange(value.remaining, 0, 1_000);
		case 'marker-jump':
			return hasOnly(value, MARKER_JUMP_RESULT_KEYS)
				&& typeof value.jumped === 'boolean'
				&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER);
		case 'marker-jump-previous':
		case 'marker-jump-next':
			return hasOnly(value, MARKER_INDEX_RESULT_KEYS)
				&& typeof value.jumped === 'boolean'
				&& (value.actualTime === null || isFiniteInRange(value.actualTime, 0, Number.MAX_SAFE_INTEGER))
				&& (value.marker === null || isMarker(value.marker));
		case 'ab-set-a':
		case 'ab-set-b':
			return hasOnly(value, AB_SET_RESULT_KEYS) && isABLoop(value.abLoop);
		case 'ab-clear':
			return hasOnly(value, AB_CLEAR_RESULT_KEYS)
				&& isABLoop(value.abLoop) && typeof value.cleared === 'boolean';
		case 'ab-skip':
			return hasOnly(value, AB_SKIP_RESULT_KEYS)
				&& isABLoop(value.abLoop)
				&& typeof value.skipped === 'boolean'
				&& (value.currentTime === null
					|| isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER));
		case 'audio-reset':
		case 'video-effects-reset':
			return hasOnly(value, RESET_RESULT_KEYS) && value.reset === true;
		case 'video-effects-toggle':
			return hasOnly(value, ENABLED_RESULT_KEYS) && typeof value.enabled === 'boolean';
		case 'show-info':
			return hasOnly(value, SHOWN_RESULT_KEYS) && typeof value.shown === 'boolean';
		case 'open-popup':
		case 'open-options':
		case 'open-url':
			return hasOnly(value, OPENED_RESULT_KEYS) && value.opened === true;
		case 'run-user-script':
			return hasOnly(value, EXECUTED_RESULT_KEYS) && value.executed === true;
	}
}

export function isUiControlSnapshot(value: unknown): value is ControlSnapshot {
	return isRecord(value)
		&& hasOnly(value, CONTROL_SNAPSHOT_KEYS)
		&& isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& isCanonicalOrigin(value.origin)
		&& isInteger(value.generation)
		&& isInteger(value.revision)
		&& (value.activeMedia === null || isMediaTarget(value.activeMedia))
		&& (value.activeVideo === null || isMediaTarget(value.activeVideo) && value.activeVideo.kind === 'video')
		&& isControlFieldStates(value.fields);
}

export function isUiControlApplyAck(value: unknown): value is ControlApplyAck {
	return isRecord(value)
		&& hasOnly(value, APPLY_ACK_KEYS)
		&& isBoundedString(value.intentId, 128)
		&& isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& isInteger(value.generation)
		&& isInteger(value.revision)
		&& (value.target === null || isMediaTarget(value.target))
		&& isControlFieldStates(value.fields)
		&& (value.audioVolume === undefined || isAudioVolumeProjection(value.audioVolume));
}

export function isUiControlOperationAck(value: unknown): value is ControlOperationAck {
	return isRecord(value)
		&& hasOnly(value, OPERATION_ACK_KEYS)
		&& isBoundedString(value.operationId, 128)
		&& isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& isInteger(value.generation)
		&& isInteger(value.revision)
		&& (value.target === null || isMediaTarget(value.target))
		&& typeof value.operation === 'string'
		&& OPERATIONS.has(value.operation as ControlOperation)
		&& typeof value.strategy === 'string'
		&& value.strategy === OPERATION_STRATEGIES[value.operation as ControlOperation]
		&& typeof value.coverage === 'string'
		&& COVERAGES.has(value.coverage)
		&& isControlFieldStates(value.fields)
		&& (value.audioVolume === undefined || isAudioVolumeProjection(value.audioVolume))
		&& isOperationResult(value.operation as ControlOperation, value.result);
}
