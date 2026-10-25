// goal: minimum runtime contract surface for the isolated SPECTRA content host
//
// Types continue to come from the canonical @nexus/contracts entry during
// typecheck. Production Content bundles alias that entry to this file so page
// code carries only the guards and constants it can actually exercise. The
// background/offscreen/UI contexts keep the complete protocol validator.

import { rpcFailure, rpcSuccess } from './spectra.protocol-primitives.js';
import {
	audioConfigToProcessorConfig,
	DEFAULT_AUDIO_CONFIG,
	isAudioCaptureState,
	isAudioConfig,
	isAudioSessionSnapshot,
	isDefaultAudioConfig,
	requiresAudioProcessor,
	resolveAudioVolume,
	resolveAudioVolumeState,
	resolveDesiredAudioMode,
} from './audio.contracts.js';
import { isAudioSitePolicy } from './settings.contracts.js';
import {
	isMediaRouteChangedEvent,
	isMediaRouteDecision,
} from './media-route.contracts.js';
import {
	CONTROL_VALUE_LIMITS,
	clampControlValue,
	compileEffectiveVolume,
	isFiniteControlValue,
	splitEffectiveVolume,
} from './control-value-limits.js';
import { isCaptureAdmission } from './capture-admission.contracts.js';
import { isAudioVisualizerDemandPayload } from './visualizer.contracts.js';
import { findBestHostnameMatch, normalizeHostname } from './domain.contracts.js';
import {
	DEFAULT_HOTKEY_SETTINGS,
	HOTKEY_ACTION_DESCRIPTORS,
	isHotkeyAction,
	isHotkeyParamsForAction,
	isSpectraDefaultHotkeyKeyCombo,
	resolveSpectraHotkeyActualFeedback,
	selectHotkeyFeedbackOwner,
	selectHotkeyRepeatPolicy,
} from './hotkeys.contracts.js';
import { isHotkeySettings } from './settings.contracts.js';
import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	resolveSpectraDefaultHotkeyAction,
} from './spectra.bootstrap.js';
import type {
	ControlField,
	ControlOperation,
	ControlStrategy,
	MediaTarget,
} from './control.contracts.js';
import type {
	RpcError,
	SpectraEventEnvelope,
	SpectraRequestEnvelope,
	SpectraRequestType,
	SpectraResponse,
} from './spectra.protocol.js';

export {
	audioConfigToProcessorConfig,
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_HOTKEY_SETTINGS,
	HOTKEY_ACTION_DESCRIPTORS,
	CONTROL_VALUE_LIMITS,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	findBestHostnameMatch,
	isAudioConfig,
	isDefaultAudioConfig,
	isFiniteControlValue,
	isHotkeyAction,
	isHotkeyParamsForAction,
	isSpectraDefaultHotkeyKeyCombo,
	normalizeHostname,
	clampControlValue,
	compileEffectiveVolume,
	requiresAudioProcessor,
	resolveAudioVolume,
	resolveAudioVolumeState,
	resolveDesiredAudioMode,
	splitEffectiveVolume,
	resolveSpectraDefaultHotkeyAction,
	resolveSpectraHotkeyActualFeedback,
	selectHotkeyFeedbackOwner,
	selectHotkeyRepeatPolicy,
};
export { createSpectraEvent, createSpectraRequest } from './spectra.wire.js';
export type { SpectraWireContext } from './spectra.wire.js';
export type {
	MediaProcessingRoute,
	MediaRouteDecision,
} from './media-route.contracts.js';

const REQUEST_KEYS = new Set(['protocolVersion', 'requestId', 'tabId', 'documentId', 'generation', 'type', 'payload']);
const EVENT_KEYS = new Set(['protocolVersion', 'tabId', 'documentId', 'generation', 'type', 'payload']);
const CONTROL_FIELDS = new Set<ControlField>([
	'audioEnabled', 'volumeBase', 'boost', 'mediaMuted', 'tabMuted', 'speed',
	'preservePitch', 'playing', 'currentTime', 'loop', 'pip', 'fullscreen',
	'rotation', 'mirrored', 'fill', 'filterEnabled', 'filter', 'dimEnabled',
	'dimOpacity', 'abLoop', 'tabPinned', 'eqValues', 'bass', 'compressor',
	'mono', 'pan', 'delay', 'visualizer',
]);
const DIRECT_FIELDS = new Set<ControlField>([...CONTROL_FIELDS].filter((field) => field !== 'visualizer'));
const STRATEGIES = new Set<ControlStrategy>([
	'observe', 'capture-observe', 'page-native', 'dom-native', 'chrome-native', 'extension-state',
	'extension-css', 'extension-overlay', 'media-webaudio', 'capture', 'unsupported',
]);
const COVERAGES = new Set(['full', 'active-target', 'partial', 'opaque']);
const PHASES = new Set(['idle', 'applied', 'error']);
const SOURCES = new Set(['page', 'popup', 'remote', 'hotkey', 'restore', 'system']);
const CONTENT_OPERATIONS = new Set<ControlOperation>([
	'restore-page-settings', 'frame-step', 'screenshot', 'marker-add', 'marker-remove',
	'marker-jump', 'marker-jump-previous', 'marker-jump-next', 'ab-set-a', 'ab-set-b',
	'ab-clear', 'ab-skip', 'show-info',
]);
const CONTENT_COMMAND_TYPES = new Set([
	'spectra.hotkey.trigger',
	'spectra.media.state.get',
	'spectra.media.play.toggle',
	'spectra.media.pip.toggle',
	'spectra.media.speed.set',
	'spectra.video.rotate',
	'spectra.video.mirror.toggle',
	'spectra.video.screenshot',
	'spectra.video.fullscreen.toggle',
	'spectra.video.crop.toggle',
	'spectra.video.seek',
	'spectra.video.filter.set',
	'spectra.video.filter.reset',
	'spectra.video.dim.toggle',
	'spectra.video.ab.a.set',
	'spectra.video.ab.b.set',
	'spectra.video.ab.clear',
	'spectra.video.ab.get',
	'spectra.video.marker.add',
	'spectra.video.marker.remove',
	'spectra.video.marker.jump',
	'spectra.video.marker.list',
]);
const MEDIA_TARGET_KEYS = new Set(['frameId', 'documentId', 'mediaId', 'sourceRevision', 'kind']);
const FILTER_KEYS = new Set(['brightness', 'contrast', 'saturate', 'grayscale', 'invert']);
const AB_LOOP_KEYS = new Set(['pointA', 'pointB', 'enabled']);
const CONTROL_FIELD_STATE_KEYS = new Set([
	'desired', 'actual', 'restoreBaseline', 'revision', 'phase', 'strategy',
	'coverage', 'controlled', 'intentId', 'lastError',
]);
const DELTA_KEYS = new Set(['delta']);
const LABEL_KEYS = new Set(['label']);
const ID_KEYS = new Set(['id']);
const CONTENT_OSD_MESSAGE_KEYS = new Set([
	'muted', 'corsAutoAdded', 'corsAddedSafe', 'corsCorrectedSafe',
]);

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

function isBoundedString(value: unknown, maximum: number): value is string {
	return typeof value === 'string'
		&& value.length <= maximum
		&& value.trim().length > 0;
}

export function isMediaTarget(value: unknown): value is MediaTarget {
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

function isControlValue(field: ControlField, value: unknown): boolean {
	switch (field) {
		case 'volumeBase': return isFiniteControlValue(value, 'nativeVolume');
		case 'boost': return isFiniteControlValue(value, 'boost');
		case 'speed': return isFiniteControlValue(value, 'speed');
		case 'currentTime': return isFiniteControlValue(value, 'currentTime');
		case 'rotation': return value === 0 || value === 90 || value === 180 || value === 270;
		case 'filter': return isFilter(value);
		case 'abLoop': return isRecord(value)
			&& hasOnly(value, AB_LOOP_KEYS)
			&& (value.pointA === null || isFiniteInRange(value.pointA, 0, Number.MAX_SAFE_INTEGER))
			&& (value.pointB === null || isFiniteInRange(value.pointB, 0, Number.MAX_SAFE_INTEGER))
			&& typeof value.enabled === 'boolean';
		case 'dimOpacity': return isFiniteControlValue(value, 'dimOpacity');
		case 'eqValues': return Array.isArray(value)
			&& value.length === 10
			&& value.every((item) => isFiniteControlValue(item, 'eqBand'));
		case 'pan': return isFiniteControlValue(value, 'pan');
		case 'delay': return isFiniteControlValue(value, 'delay');
		default: return typeof value === 'boolean';
	}
}

function isControlPatch(value: unknown, allowEmpty = false): boolean {
	if (!isRecord(value) || !hasOnly(value, DIRECT_FIELDS) || (!allowEmpty && Object.keys(value).length === 0)) return false;
	return Object.entries(value).every(([field, item]) => isControlValue(field as ControlField, item));
}

function isControlFieldStates(value: unknown): boolean {
	if (!isRecord(value) || !hasOnly(value, CONTROL_FIELDS)) return false;
	return Object.entries(value).every(([field, item]) => {
		if (!isRecord(item)
			|| !hasOnly(item, CONTROL_FIELD_STATE_KEYS)) return false;
		return (item.desired === null || isControlValue(field as ControlField, item.desired))
			&& (item.actual === null || isControlValue(field as ControlField, item.actual))
			&& (item.restoreBaseline === undefined || isControlValue(field as ControlField, item.restoreBaseline))
			&& isInteger(item.revision)
			&& PHASES.has(item.phase as string)
			&& STRATEGIES.has(item.strategy as ControlStrategy)
			&& COVERAGES.has(item.coverage as string)
			&& typeof item.controlled === 'boolean'
			&& (item.intentId === undefined || isBoundedString(item.intentId, 128))
			&& (item.lastError === null || isRpcError(item.lastError));
	});
}

function isControlIntent(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnly(value, new Set([
			'intentId', 'tabId', 'documentId', 'generation', 'baseRevision', 'source',
			'requestedCoverage', 'target', 'actualContext', 'patch', 'captureAdmission',
			'processorHold',
		]))) return false;
	return isBoundedString(value.intentId, 128)
		&& isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& isInteger(value.generation)
		&& isInteger(value.baseRevision)
		&& SOURCES.has(value.source as string)
		&& (value.requestedCoverage === 'active-target' || value.requestedCoverage === 'full')
		&& (value.target === null || isMediaTarget(value.target))
		&& isControlPatch(value.actualContext, true)
		&& isControlPatch(value.patch)
		&& (value.captureAdmission === undefined
			|| isCaptureAdmission(value.captureAdmission))
		&& (value.processorHold === undefined || typeof value.processorHold === 'boolean');
}

function isControlReadRequest(value: unknown): boolean {
	return isRecord(value)
		&& hasOnly(value, new Set(['fields', 'target']))
		&& Array.isArray(value.fields)
		&& value.fields.length > 0
		&& value.fields.length <= DIRECT_FIELDS.size
		&& new Set(value.fields).size === value.fields.length
		&& value.fields.every((field) => DIRECT_FIELDS.has(field as ControlField))
		&& (value.target === null || isMediaTarget(value.target));
}

function isOperationPayload(operation: ControlOperation, value: unknown): boolean {
	if (!isRecord(value)) return false;
	switch (operation) {
		case 'restore-page-settings': return hasOnly(value, new Set());
		case 'frame-step': return hasOnly(value, new Set(['direction']))
			&& (value.direction === -1 || value.direction === 1);
		case 'marker-add': return hasOnly(value, LABEL_KEYS)
			&& (value.label === undefined || typeof value.label === 'string' && value.label.length <= 256);
		case 'marker-remove':
		case 'marker-jump': return hasOnly(value, ID_KEYS) && isBoundedString(value.id, 128);
		default: return Object.keys(value).length === 0;
	}
}

function isControlOperationIntent(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnly(value, new Set([
			'operationId', 'tabId', 'documentId', 'generation', 'baseRevision', 'source',
			'target', 'operation', 'payload',
		]))) return false;
	const operation = value.operation as ControlOperation;
	return isBoundedString(value.operationId, 128)
		&& isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& isInteger(value.generation)
		&& isInteger(value.baseRevision)
		&& value.source !== 'page'
		&& value.source !== 'system'
		&& SOURCES.has(value.source as string)
		&& (value.target === null || isMediaTarget(value.target))
		&& CONTENT_OPERATIONS.has(operation)
		&& isOperationPayload(operation, value.payload);
}

function isEmpty(value: unknown): boolean {
	return isRecord(value) && Object.keys(value).length === 0;
}

function isContentCommandPayload(type: string, value: unknown): boolean {
	if (type === 'spectra.media.speed.set') {
		return isRecord(value)
			&& hasOnly(value, new Set(['speed', 'delta', 'preservePitch']))
			&& (value.speed === undefined) !== (value.delta === undefined)
			&& (value.speed === undefined || isFiniteControlValue(value.speed, 'speed'))
			&& (value.delta === undefined || isFiniteInRange(value.delta, -15.9, 15.9))
			&& (value.preservePitch === undefined || typeof value.preservePitch === 'boolean');
	}
	if (type === 'spectra.video.rotate') return isRecord(value)
		&& hasOnly(value, DELTA_KEYS) && (value.delta === -90 || value.delta === 90);
	if (type === 'spectra.video.seek') return isRecord(value)
		&& hasOnly(value, DELTA_KEYS) && isFiniteInRange(value.delta, -86_400, 86_400);
	if (type === 'spectra.video.filter.set') return isFilter(value);
	if (type === 'spectra.video.dim.toggle') return isRecord(value)
		&& hasOnly(value, new Set(['enabled', 'opacity']))
		&& (value.enabled === undefined || typeof value.enabled === 'boolean')
		&& (value.opacity === undefined || isFiniteInRange(value.opacity, 0, 1));
	if (type === 'spectra.video.marker.add') return isRecord(value)
		&& hasOnly(value, LABEL_KEYS)
		&& (value.label === undefined || typeof value.label === 'string' && value.label.length <= 256);
	if (type === 'spectra.video.marker.remove' || type === 'spectra.video.marker.jump') {
		return isRecord(value) && hasOnly(value, ID_KEYS) && isBoundedString(value.id, 128);
	}
	if (type === 'spectra.hotkey.trigger') return isRecord(value)
		&& hasOnly(value, new Set(['action'])) && typeof value.action === 'string' && value.action.length <= 64;
	return isEmpty(value);
}

function hasRequestBase(value: Record<string, unknown>): boolean {
	return hasOnly(value, REQUEST_KEYS)
		&& value.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& isBoundedString(value.requestId, 128)
		&& (value.tabId === undefined || isInteger(value.tabId, true))
		&& (value.documentId === undefined || isBoundedString(value.documentId, 256))
		&& (value.generation === undefined || isInteger(value.generation));
}

export function isSpectraRequestEnvelope(value: unknown): value is SpectraRequestEnvelope {
	if (!isRecord(value) || !hasRequestBase(value) || typeof value.type !== 'string') return false;
	if (value.type === 'spectra.control.intent.execute') {
		return isControlIntent(value.payload)
			&& isRecord(value.payload)
			&& value.tabId === value.payload.tabId
			&& value.documentId === value.payload.documentId
			&& value.generation === value.payload.generation;
	}
	if (value.type === 'spectra.control.actual.read') return isControlReadRequest(value.payload);
	if (value.type === 'spectra.control.operation.execute') {
		return isControlOperationIntent(value.payload)
			&& isRecord(value.payload)
			&& value.tabId === value.payload.tabId
			&& value.documentId === value.payload.documentId
			&& value.generation === value.payload.generation;
	}
	if (value.type === 'spectra.screenshot.target.verify') return isRecord(value.payload)
		&& hasOnly(value.payload, new Set(['captureToken']))
		&& isBoundedString(value.payload.captureToken, 128);
	if (value.type === 'spectra.audio.visualizer.demand.set') {
		if (!isInteger(value.tabId, true)
			|| !isBoundedString(value.documentId, 256)
			|| !isInteger(value.generation)
			|| !isAudioVisualizerDemandPayload(value.payload)) return false;
		return value.payload.admission === undefined || (
			value.tabId === value.payload.admission.document.tabId
			&& value.documentId === value.payload.admission.document.documentId
			&& value.generation === value.payload.admission.documentEpoch
		);
	}
	if (value.type === 'spectra.audio.visualizer.get') {
		return isInteger(value.tabId, true) && isEmpty(value.payload);
	}
	if (value.type === 'spectra.audio.runtime.get') return isInteger(value.tabId, true) && isEmpty(value.payload);
	if (value.type === 'spectra.audio.runtime.configure') return isInteger(value.tabId, true)
		&& isRecord(value.payload) && hasOnly(value.payload, new Set(['config'])) && isAudioConfig(value.payload.config);
	return CONTENT_COMMAND_TYPES.has(value.type)
		&& isInteger(value.tabId, true)
		&& isContentCommandPayload(value.type, value.payload);
}

function isContentSettings(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnly(value, new Set([
			'osdEnabled', 'visualizerEnabled', 'lang', 'themeMode', 'pauseRetentionSeconds', 'osdMessages',
		]))) return false;
	const osdMessages = value.osdMessages;
	return typeof value.osdEnabled === 'boolean'
		&& typeof value.visualizerEnabled === 'boolean'
		&& isBoundedString(value.lang, 16)
		&& (value.themeMode === 'system' || value.themeMode === 'light' || value.themeMode === 'dark')
		&& isFiniteInRange(value.pauseRetentionSeconds, 0, 86_400)
		&& isRecord(osdMessages)
		&& hasOnly(osdMessages, CONTENT_OSD_MESSAGE_KEYS)
		&& isBoundedString(osdMessages.muted, 128)
		&& ['corsAutoAdded', 'corsAddedSafe', 'corsCorrectedSafe']
			.every((key) => isBoundedString(osdMessages[key], 256));
}

export function isSpectraEventEnvelope(value: unknown): value is SpectraEventEnvelope {
	if (!isRecord(value)
		|| !hasOnly(value, EVENT_KEYS)
		|| value.protocolVersion !== SPECTRA_PROTOCOL_VERSION
		|| typeof value.type !== 'string'
		|| (value.tabId !== undefined && !isInteger(value.tabId, true))
		|| (value.documentId !== undefined && !isBoundedString(value.documentId, 256))
		|| (value.generation !== undefined && !isInteger(value.generation))) return false;
	if (value.type === 'spectra.audio.capture.changed') return isAudioCaptureState(value.payload)
		&& isRecord(value.payload)
		&& value.tabId === value.payload.tabId
		&& isBoundedString(value.documentId, 256)
		&& value.generation === value.payload.generation;
	if (value.type === 'spectra.content.settings.changed') return isContentSettings(value.payload);
	if (value.type === 'spectra.audio.route.changed') return isMediaRouteChangedEvent(value.payload);
	if (value.type === 'spectra.hotkeys.changed') return isHotkeySettings(value.payload);
	if (value.type === 'spectra.hotkey.target.feedback') return isInteger(value.tabId, true)
		&& isRecord(value.payload)
		&& hasOnly(value.payload, new Set([
			'action', 'targetTabId', 'targetTitle', 'targetHostname', 'gesture', 'feedback',
		]))
		&& typeof value.payload.action === 'string'
		&& isHotkeyAction(value.payload.action)
		&& isInteger(value.payload.targetTabId, true)
		&& isBoundedString(value.payload.targetTitle, 512)
		&& isBoundedString(value.payload.targetHostname, 253)
		&& (value.payload.gesture === undefined || isBoundedString(value.payload.gesture, 128))
		&& (value.payload.feedback === undefined || (
			isRecord(value.payload.feedback)
			&& (value.payload.feedback.kind === 'volume'
				? hasOnly(value.payload.feedback, new Set(['kind', 'value', 'volumeState']))
					&& isFiniteControlValue(value.payload.feedback.value, 'volume')
					&& (value.payload.feedback.volumeState === 'silent'
						|| value.payload.feedback.volumeState === 'native'
						|| value.payload.feedback.volumeState === 'capture')
				: value.payload.feedback.kind === 'speed'
					&& hasOnly(value.payload.feedback, new Set(['kind', 'value']))
					&& isFiniteControlValue(value.payload.feedback.value, 'speed'))
		));
	if (value.type === 'spectra.navigation.changed') return isInteger(value.tabId, true)
		&& isBoundedString(value.documentId, 256)
		&& value.generation === undefined
		&& isRecord(value.payload)
		&& hasOnly(value.payload, new Set(['url']))
		&& isBoundedString(value.payload.url, 4096);
	return false;
}

function isRpcError(value: unknown): value is RpcError {
	return isRecord(value)
		&& hasOnly(value, new Set(['code', 'message', 'retryable']))
		&& isBoundedString(value.code, 128)
		&& isBoundedString(value.message, 4096)
		&& typeof value.retryable === 'boolean';
}

function isControlAck(value: unknown, operation = false): boolean {
	if (!isRecord(value)
		|| !isBoundedString(operation ? value.operationId : value.intentId, 128)
		|| !isInteger(value.tabId, true)
		|| !isBoundedString(value.documentId, 256)
		|| !isInteger(value.generation)
		|| !isInteger(value.revision)
		|| (value.target !== null && !isMediaTarget(value.target))
		|| !isControlFieldStates(value.fields)
		|| (value.audioVolume !== undefined && !(
			isRecord(value.audioVolume)
			&& hasOnly(value.audioVolume, new Set(['effectiveVolume', 'volumeState']))
		&& isFiniteControlValue(value.audioVolume.effectiveVolume, 'volume')
			&& (value.audioVolume.volumeState === 'silent'
				|| value.audioVolume.volumeState === 'native'
				|| value.audioVolume.volumeState === 'capture')
		))) return false;
	if (!operation) return hasOnly(value, new Set([
		'intentId', 'tabId', 'documentId', 'generation', 'revision', 'target',
		'fields', 'audioVolume',
	]));
	return hasOnly(value, new Set([
		'operationId', 'tabId', 'documentId', 'generation', 'revision', 'target',
		'operation', 'strategy', 'coverage', 'fields', 'audioVolume', 'result',
	]))
		&& typeof value.operation === 'string'
		&& STRATEGIES.has(value.strategy as ControlStrategy)
		&& COVERAGES.has(value.coverage as string)
		&& isRecord(value.result);
}

function isContentResponseData(type: string, value: unknown): boolean {
	if (type === 'spectra.content.runtime.identity') return isRecord(value)
		&& hasOnly(value, new Set(['documentId', 'frameId']))
		&& isBoundedString(value.documentId, 256)
		&& value.frameId === 0;
	if (type === 'spectra.content.runtime.ready'
		|| type === 'spectra.content.source.released'
		|| type === 'spectra.content.target.changed') return isRecord(value)
		&& hasOnly(value, new Set(['accepted'])) && value.accepted === true;
	if (type === 'spectra.control.intent.submit') return isControlAck(value);
	if (type === 'spectra.control.operation.submit') return isControlAck(value, true);
	if (type === 'spectra.content.settings.get') return isContentSettings(value);
	if (type === 'spectra.audio.config.get') return isAudioConfig(value);
	if (type === 'spectra.audio.policy.get') return isAudioSitePolicy(value);
	if (type === 'spectra.audio.route.get' || type === 'spectra.audio.route.record') {
		return isMediaRouteDecision(value);
	}
	if (type === 'spectra.audio.config.set') return isRecord(value)
		&& hasOnly(value, new Set(['saved'])) && value.saved === true;
	if (type === 'spectra.audio.session.current') return value === null || isAudioSessionSnapshot(value);
	if (type === 'spectra.audio.session.publish') return isAudioSessionSnapshot(value);
	if (type === 'spectra.audio.session.flush') return isRecord(value)
		&& hasOnly(value, new Set(['flushed'])) && value.flushed === true;
	if (type === 'spectra.audio.capture.set') {
		if (!isRecord(value) || !hasOnly(value, new Set([
			'tabId', 'generation', 'phase', 'active', 'actualMode', 'lastError',
			'actualConfig', 'continuationAdmission',
		]))) return false;
		const { continuationAdmission: _, ...state } = value;
		if (!isAudioCaptureState(state)) return false;
		return value.continuationAdmission === undefined
			|| value.active === false
				&& value.phase === 'idle'
				&& isCaptureAdmission(value.continuationAdmission)
				&& value.continuationAdmission.kind === 'capture-resume';
	}
	if (type === 'spectra.audio.capture.config') return isAudioCaptureState(value);
	if (type === 'spectra.hotkeys.get') return isHotkeySettings(value);
	if (type === 'spectra.screenshot.capture-visible') return isRecord(value)
		&& hasOnly(value, new Set(['saved', 'method', 'width', 'height']))
		&& value.saved === true
		&& value.method === 'capture-visible-tab'
		&& isFiniteInRange(value.width, 1, 100_000)
		&& isFiniteInRange(value.height, 1, 100_000);
	if (type === 'spectra.tab.media.report') return isRecord(value)
		&& hasOnly(value, new Set(['reported'])) && value.reported === true;
	return false;
}

export function isSpectraResponse<T extends SpectraRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<T> {
	if (!isRecord(value)) return false;
	if (value.ok === true) return hasOnly(value, new Set(['ok', 'data']))
		&& isContentResponseData(type, value.data);
	return value.ok === false
		&& hasOnly(value, new Set(['ok', 'error']))
		&& isRpcError(value.error);
}

export { rpcFailure, rpcSuccess };
