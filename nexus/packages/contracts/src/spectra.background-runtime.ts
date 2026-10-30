// goal: canonical request-payload guards needed by the Background ingress
// without importing the complete SPECTRA protocol validator

import {
	isAudioConfig,
} from './audio.contracts.js';
import { isCaptureAdmission } from './capture-admission.contracts.js';
import {
	isControlIntent,
	isControlOperationIntent,
	isMediaTarget,
} from './control.contracts.js';
import { isRemoteSessionToken } from './remote.contracts.js';
import {
	hasOnlyProtocolKeys,
	isDocumentId,
	isFiniteInRange,
	isNonNegativeInteger,
	isPositiveInteger,
	isProtocolRecord,
	isRuntimeRevision,
	type ProtocolRecord,
} from './spectra.protocol-primitives.js';
import type {
	AudioCaptureTransitionPayload,
	AudioSessionPublishPayload,
	ContentRuntimeLeaseReason,
	ScreenshotCapturePayload,
	SpectraRequestPayload,
} from './spectra.protocol.js';
import {
	isAudioVisualizerDemandPayload,
} from './visualizer.contracts.js';
import type {
	AudioConfig,
	AudioSessionPhase,
	SpectraAudioMode,
} from './audio.contracts.js';

const CONTENT_BOOTSTRAP_HELLO_PAYLOAD_KEYS = new Set(['bootstrapRevision']);
const CONTENT_RUNTIME_ENSURE_PAYLOAD_KEYS = new Set(['tabId', 'documentId', 'reason', 'capability']);
const CONTENT_RUNTIME_REVISION_PAYLOAD_KEYS = new Set(['runtimeRevision']);
const CONTENT_RUNTIME_RELEASE_PAYLOAD_KEYS = new Set([
	'runtimeRevision', 'tabId', 'documentId', 'reason', 'capability',
]);
const CONTENT_SOURCE_RELEASED_PAYLOAD_KEYS = new Set(['target']);
const CONTENT_TARGET_CHANGED_PAYLOAD_KEYS = new Set(['target']);
const AUDIO_SESSION_GET_PAYLOAD_KEYS = new Set(['tabId']);
const AUDIO_CONFIG_PAYLOAD_KEYS = new Set(['config']);
const AUDIO_SESSION_PUBLISH_PAYLOAD_KEYS = new Set([
	'config',
	'desiredMode',
	'actualMode',
	'phase',
	'lastError',
	'userInteracted',
]);
const AUDIO_CAPTURE_SET_PAYLOAD_KEYS = new Set([
	'enabled', 'config', 'admission', 'requestContinuation',
]);
const SCREENSHOT_CAPTURE_PAYLOAD_KEYS = new Set(['captureToken', 'rect']);
const SCREENSHOT_RECT_KEYS = new Set(['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight']);
const UI_OPEN_PAYLOAD_KEYS = new Set(['view']);
const TAB_ID_PAYLOAD_KEYS = new Set(['tabId']);
const REMOTE_SESSION_PAYLOAD_KEYS = new Set(['tabId']);
const REMOTE_SESSION_CLOSE_PAYLOAD_KEYS = new Set(['tabId', 'sessionId']);
const USER_SCRIPT_PAYLOAD_KEYS = new Set(['script']);
const TAB_MEDIA_REPORT_PAYLOAD_KEYS = new Set(['hasMediaElement', 'userInteracted', 'reportRevision']);
const CONTENT_RUNTIME_LEASE_REASONS = new Set<ContentRuntimeLeaseReason>([
	'control',
	'restore',
	'hotkey',
	'remote',
	'observation',
	'visualizer',
]);
const AUDIO_SESSION_MODES = new Set<SpectraAudioMode>(['bypass', 'webaudio', 'capture']);
const AUDIO_SESSION_PHASES = new Set<AudioSessionPhase>([
	'idle', 'starting', 'active', 'stopping', 'error',
]);

export function isContentBootstrapHelloPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.bootstrap.hello'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, CONTENT_BOOTSTRAP_HELLO_PAYLOAD_KEYS)
		&& isRuntimeRevision(value.bootstrapRevision);
}

export function isContentRuntimeEnsurePayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.runtime.ensure'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, CONTENT_RUNTIME_ENSURE_PAYLOAD_KEYS)
		&& isPositiveInteger(value.tabId)
		&& (value.documentId === undefined || isDocumentId(value.documentId))
		&& typeof value.reason === 'string'
		&& CONTENT_RUNTIME_LEASE_REASONS.has(value.reason as ContentRuntimeLeaseReason)
		&& (value.capability === undefined || (
			typeof value.capability === 'string'
			&& value.capability.length > 0
			&& value.capability.length <= 128
		));
}

export function isContentRuntimeRevisionPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.runtime.ready'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, CONTENT_RUNTIME_REVISION_PAYLOAD_KEYS)
		&& isRuntimeRevision(value.runtimeRevision);
}

export function isContentRuntimeReleasePayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.runtime.release'> {
	if (!isProtocolRecord(value)
		|| !hasOnlyProtocolKeys(value, CONTENT_RUNTIME_RELEASE_PAYLOAD_KEYS)
		|| !isRuntimeRevision(value.runtimeRevision)) return false;
	return (value.tabId === undefined || isPositiveInteger(value.tabId))
		&& (value.documentId === undefined || isDocumentId(value.documentId))
		&& (value.reason === undefined || (
			typeof value.reason === 'string'
			&& CONTENT_RUNTIME_LEASE_REASONS.has(value.reason as ContentRuntimeLeaseReason)
		))
		&& (value.capability === undefined || (
			typeof value.capability === 'string'
			&& value.capability.length > 0
			&& value.capability.length <= 128
		));
}

export function isContentSourceReleasedPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.source.released'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, CONTENT_SOURCE_RELEASED_PAYLOAD_KEYS)
		&& isMediaTarget(value.target);
}

export function isContentTargetChangedPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.content.target.changed'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, CONTENT_TARGET_CHANGED_PAYLOAD_KEYS)
		&& isMediaTarget(value.target);
}

export function isTabIdPayload(value: unknown): value is { tabId: number } {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, TAB_ID_PAYLOAD_KEYS)
		&& isPositiveInteger(value.tabId);
}

export function isAudioSessionGetPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.audio.session.get'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, AUDIO_SESSION_GET_PAYLOAD_KEYS)
		&& isPositiveInteger(value.tabId);
}

export function isAudioConfigPayload(value: unknown): value is { config: AudioConfig } {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, AUDIO_CONFIG_PAYLOAD_KEYS)
		&& isAudioConfig(value.config);
}

export function isAudioCaptureSetPayload(
	value: unknown,
): value is AudioCaptureTransitionPayload {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, AUDIO_CAPTURE_SET_PAYLOAD_KEYS)
		&& typeof value.enabled === 'boolean'
		&& isAudioConfig(value.config)
		&& (value.enabled
			? isCaptureAdmission(value.admission)
				&& value.requestContinuation === undefined
			: value.admission === undefined
				&& (value.requestContinuation === undefined
					|| typeof value.requestContinuation === 'boolean'));
}

export function isAudioSessionPublishPayload(
	value: unknown,
): value is AudioSessionPublishPayload {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, AUDIO_SESSION_PUBLISH_PAYLOAD_KEYS)
		&& isAudioConfig(value.config)
		&& typeof value.desiredMode === 'string'
		&& AUDIO_SESSION_MODES.has(value.desiredMode as SpectraAudioMode)
		&& typeof value.actualMode === 'string'
		&& AUDIO_SESSION_MODES.has(value.actualMode as SpectraAudioMode)
		&& typeof value.phase === 'string'
		&& AUDIO_SESSION_PHASES.has(value.phase as AudioSessionPhase)
		&& (value.lastError === null || (
			typeof value.lastError === 'string'
			&& value.lastError.length > 0
			&& value.lastError.length <= 4096
		))
		&& typeof value.userInteracted === 'boolean';
}

export function isScreenshotCapturePayload(
	value: unknown,
): value is ScreenshotCapturePayload {
	if (!isProtocolRecord(value)
		|| !hasOnlyProtocolKeys(value, SCREENSHOT_CAPTURE_PAYLOAD_KEYS)
		|| typeof value.captureToken !== 'string'
		|| value.captureToken.length === 0
		|| value.captureToken.length > 128
		|| !isProtocolRecord(value.rect)
		|| !hasOnlyProtocolKeys(value.rect, SCREENSHOT_RECT_KEYS)) return false;
	return isFiniteInRange(value.rect.x, -100_000, 100_000)
		&& isFiniteInRange(value.rect.y, -100_000, 100_000)
		&& isFiniteInRange(value.rect.width, 1, 100_000)
		&& isFiniteInRange(value.rect.height, 1, 100_000)
		&& isFiniteInRange(value.rect.viewportWidth, 1, 100_000)
		&& isFiniteInRange(value.rect.viewportHeight, 1, 100_000);
}

export function isUiOpenPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.ui.open'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, UI_OPEN_PAYLOAD_KEYS)
		&& (value.view === 'options' || value.view === 'popup');
}

export function isRemoteSessionPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.remote.session.get' | 'spectra.remote.session.create'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, REMOTE_SESSION_PAYLOAD_KEYS)
		&& isPositiveInteger(value.tabId);
}

export function isRemoteSessionClosePayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.remote.session.close'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, REMOTE_SESSION_CLOSE_PAYLOAD_KEYS)
		&& isPositiveInteger(value.tabId)
		&& isRemoteSessionToken(value.sessionId);
}

export function isUserScriptPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.user-script.execute'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, USER_SCRIPT_PAYLOAD_KEYS)
		&& typeof value.script === 'string'
		&& value.script.length > 0
		&& value.script.length <= 100_000;
}

export function isTabMediaReportPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.tab.media.report'> {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, TAB_MEDIA_REPORT_PAYLOAD_KEYS)
		&& typeof value.hasMediaElement === 'boolean'
		&& typeof value.userInteracted === 'boolean'
		&& (value.reportRevision === undefined || isPositiveInteger(value.reportRevision));
}

// The generic validator and the Background ingress share these sender/context
// rules. Keeping them here prevents a slim ingress from silently accepting a
// request that the canonical protocol rejects.
export function hasCanonicalRequestContext(
	type: string,
	value: ProtocolRecord,
): boolean {
	const payload = value.payload;
	if (type === 'spectra.audio.session.get') {
		return isAudioSessionGetPayload(payload)
			&& (value.tabId === undefined || value.tabId === payload.tabId);
	}
	if (type === 'spectra.audio.session.current'
		|| type === 'spectra.content.default-hotkey.trigger') {
		return value.tabId === undefined
			&& value.documentId === undefined
			&& value.generation === undefined;
	}
	if (type === 'spectra.content.inject') {
		return isTabIdPayload(payload) && value.tabId === payload.tabId;
	}
	if (type === 'spectra.content.source.released'
		|| type === 'spectra.content.target.changed') {
		return isProtocolRecord(payload)
			&& isMediaTarget(payload.target)
			&& value.tabId === undefined
			&& value.generation === undefined
			&& (value.documentId === undefined || value.documentId === payload.target.documentId);
	}
	if (type === 'spectra.control.intent.execute'
		|| type === 'spectra.control.operation.execute') {
		const payloadIsIntent = type === 'spectra.control.intent.execute'
			? isControlIntent(payload)
			: isControlOperationIntent(payload);
		return payloadIsIntent
			&& isPositiveInteger(value.tabId)
			&& isProtocolRecord(payload)
			&& value.tabId === payload.tabId
			&& isDocumentId(value.documentId)
			&& value.documentId === payload.documentId
			&& isNonNegativeInteger(value.generation)
			&& value.generation === payload.generation;
	}
	if (type === 'spectra.control.intent.submit'
		|| type === 'spectra.control.operation.submit') {
		return isProtocolRecord(payload)
			&& (payload.tabId === undefined
				|| value.tabId === undefined
				|| value.tabId === payload.tabId);
	}
	if (type === 'spectra.audio.runtime.get'
		|| type === 'spectra.audio.runtime.configure'
		|| type === 'spectra.audio.visualizer.get'
		|| type === 'spectra.hotkey.trigger'
		|| type.startsWith('spectra.media.')
		|| type.startsWith('spectra.video.')) {
		return isPositiveInteger(value.tabId);
	}
	if (type === 'spectra.audio.visualizer.demand.set') {
		if (!isAudioVisualizerDemandPayload(payload)
			|| !isPositiveInteger(value.tabId)
			|| !isDocumentId(value.documentId)
			|| !isNonNegativeInteger(value.generation)) return false;
		return payload.admission === undefined || (
			value.tabId === payload.admission.document.tabId
			&& value.documentId === payload.admission.document.documentId
			&& value.generation === payload.admission.documentEpoch
		);
	}
	if (type === 'spectra.audio.session.publish'
		|| type === 'spectra.audio.capture.set'
		|| type === 'spectra.audio.capture.config') {
		return isNonNegativeInteger(value.generation);
	}
	if (type === 'spectra.remote.session.get'
		|| type === 'spectra.remote.session.create'
		|| type === 'spectra.remote.session.close') {
		return isProtocolRecord(payload)
			&& isPositiveInteger(payload.tabId)
			&& value.tabId === payload.tabId;
	}
	return true;
}
