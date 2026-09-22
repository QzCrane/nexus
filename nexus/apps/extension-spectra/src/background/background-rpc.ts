// goal: keep the MV3 worker's RPC boundary limited to its registered routes
// while reusing the canonical per-message guards owned by @nexus/contracts

import {
	isAudioConfig,
	isAudioSitePolicy,
	isAudioRuntimeStatus,
	isAudioSessionSnapshot,
	isControlApplyAck,
	isControlOperationAck,
	isControlReadResult,
	isControlSnapshot,
	isControlOperationRequest,
	isControlSubmitRequest,
	isAudioCaptureSetPayload,
	isAudioConfigPayload,
	isAudioSessionGetPayload,
	isAudioSessionPublishPayload,
	hasCanonicalRequestContext,
	isContentBootstrapHelloPayload,
	isContentRuntimeEnsurePayload,
	isContentRuntimeReleasePayload,
	isContentRuntimeRevisionPayload,
	isContentSourceReleasedPayload,
	isContentTargetChangedPayload,
	isEmptyPayload,
	isRemoteSessionClosePayload,
	isRemoteSessionPayload,
	isScreenshotCapturePayload,
	isTabIdPayload,
	isTabMediaReportPayload,
	isUiOpenPayload,
	isUserScriptPayload,
	isVisualizerBatchPayload,
	isVisualizerFrameResult,
	isHotkeyTargetState,
	isRegistryAddPayload,
	isRegistryQueryPayload,
	isRegistryRemovePayload,
	isRegistryRecordPayload,
	isRegistryAddResult,
	isRegistryQueryResult,
	isRegistryRemoveResult,
	isRegistrySnapshot,
	isMediaRouteDecision,
	isMediaRouteRecordRequest,
	isSettingsPatchRequest,
	isSpectraDefaultHotkeyTriggerPayload,
	isSettingsSnapshot,
	SPECTRA_PROTOCOL_VERSION,
	hasValidEventEnvelopeBase,
	hasValidRequestEnvelopeBase,
	isProtocolRecord,
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
} from '@nexus/contracts';
import {
	isSettingsUiPatchRequest,
	isSettingsUiSnapshot,
} from '@nexus/contracts/ui-settings-runtime';
import type {
	RpcResult,
	SpectraEventEnvelope,
	SpectraRequestEnvelope,
	SpectraRequestPayload,
	SpectraRequestType,
	SpectraResponse,
} from '@nexus/contracts';

export const BACKGROUND_REQUEST_TYPES = [
	'spectra.content.bootstrap.hello',
	'spectra.content.runtime.status',
	'spectra.content.runtime.identity',
	'spectra.content.runtime.ensure',
	'spectra.content.runtime.ready',
	'spectra.content.runtime.release',
	'spectra.content.default-hotkey.trigger',
	'spectra.content.source.released',
	'spectra.content.target.changed',
	'spectra.control.snapshot.get',
	'spectra.control.intent.submit',
	'spectra.control.operation.submit',
	'spectra.content.settings.get',
	'spectra.settings.get',
	'spectra.settings.patch',
	'spectra.settings.ui.get',
	'spectra.settings.ui.patch',
	'spectra.settings.flush',
	'spectra.hotkeys.get',
	'spectra.registry.get',
	'spectra.registry.add',
	'spectra.registry.remove',
	'spectra.registry.query',
	'spectra.registry.mark-probed',
	'spectra.hotkey-target.get',
	'spectra.hotkey-target.set',
	'spectra.remote.session.get',
	'spectra.remote.session.create',
	'spectra.remote.session.close',
	'spectra.user-script.execute',
	'spectra.audio.config.get',
	'spectra.audio.policy.get',
	'spectra.audio.route.get',
	'spectra.audio.route.record',
	'spectra.audio.page-scale.record',
	'spectra.audio.config.set',
	'spectra.audio.session.get',
	'spectra.audio.session.current',
	'spectra.audio.session.publish',
	'spectra.audio.session.flush',
	'spectra.audio.visualizer.batch',
	'spectra.audio.capture.set',
	'spectra.audio.capture.config',
	'spectra.screenshot.capture-visible',
	'spectra.tab.media.report',
	'spectra.tab.visible.list',
	'spectra.tab.visible.settle',
	'spectra.content.inject',
	'spectra.tab.pinned.toggle',
	'spectra.tab.muted.toggle',
	'spectra.ui.open',
];

export type BackgroundRequestType = typeof BACKGROUND_REQUEST_TYPES[number];

const backgroundRequestTypeSet = new Set<string>(BACKGROUND_REQUEST_TYPES);
type PayloadGuard = (value: unknown) => boolean;

// The route table owns only Background admission; every payload guard is
// canonical and lives in the contracts package.
export const BACKGROUND_REQUEST_GUARDS: Readonly<Record<string, PayloadGuard>> = {
	'spectra.content.bootstrap.hello': isContentBootstrapHelloPayload,
	'spectra.content.runtime.status': isEmptyPayload,
	'spectra.content.runtime.identity': isEmptyPayload,
	'spectra.content.runtime.ensure': isContentRuntimeEnsurePayload,
	'spectra.content.runtime.ready': isContentRuntimeRevisionPayload,
	'spectra.content.runtime.release': isContentRuntimeReleasePayload,
	'spectra.content.default-hotkey.trigger': isSpectraDefaultHotkeyTriggerPayload,
	'spectra.content.source.released': isContentSourceReleasedPayload,
	'spectra.content.target.changed': isContentTargetChangedPayload,
	'spectra.control.snapshot.get': isTabIdPayload,
	'spectra.control.intent.submit': isControlSubmitRequest,
	'spectra.control.operation.submit': isControlOperationRequest,
	'spectra.content.settings.get': isEmptyPayload,
	'spectra.settings.get': isEmptyPayload,
	'spectra.settings.patch': isSettingsPatchRequest,
	'spectra.settings.ui.get': isEmptyPayload,
	'spectra.settings.ui.patch': isSettingsUiPatchRequest,
	'spectra.settings.flush': isEmptyPayload,
	'spectra.hotkeys.get': isEmptyPayload,
	'spectra.registry.get': isEmptyPayload,
	'spectra.registry.add': isRegistryAddPayload,
	'spectra.registry.remove': isRegistryRemovePayload,
	'spectra.registry.query': isRegistryQueryPayload,
	'spectra.registry.mark-probed': isRegistryRecordPayload,
	'spectra.hotkey-target.get': isEmptyPayload,
	'spectra.hotkey-target.set': isHotkeyTargetState,
	'spectra.remote.session.get': isRemoteSessionPayload,
	'spectra.remote.session.create': isRemoteSessionPayload,
	'spectra.remote.session.close': isRemoteSessionClosePayload,
	'spectra.user-script.execute': isUserScriptPayload,
	'spectra.audio.config.get': isEmptyPayload,
	'spectra.audio.policy.get': isEmptyPayload,
	'spectra.audio.route.get': isEmptyPayload,
	'spectra.audio.route.record': isMediaRouteRecordRequest,
	'spectra.audio.page-scale.record': (
		value: unknown,
	): value is SpectraRequestPayload<'spectra.audio.page-scale.record'> => {
		return isProtocolRecord(value) && typeof value.supported === 'boolean';
	},
	'spectra.audio.config.set': isAudioConfigPayload,
	'spectra.audio.session.get': isAudioSessionGetPayload,
	'spectra.audio.session.current': isEmptyPayload,
	'spectra.audio.session.publish': isAudioSessionPublishPayload,
	'spectra.audio.session.flush': isEmptyPayload,
	'spectra.audio.visualizer.batch': isVisualizerBatchPayload,
	'spectra.audio.capture.set': isAudioCaptureSetPayload,
	'spectra.audio.capture.config': isAudioConfigPayload,
	'spectra.screenshot.capture-visible': isScreenshotCapturePayload,
	'spectra.tab.media.report': isTabMediaReportPayload,
	'spectra.tab.visible.list': isEmptyPayload,
	'spectra.tab.visible.settle': isEmptyPayload,
	'spectra.content.inject': isTabIdPayload,
	'spectra.tab.pinned.toggle': isEmptyPayload,
	'spectra.tab.muted.toggle': isEmptyPayload,
	'spectra.ui.open': isUiOpenPayload,
} satisfies Record<BackgroundRequestType, (value: unknown) => boolean>;

export function isBackgroundRequestType(value: unknown): value is BackgroundRequestType {
	return typeof value === 'string' && backgroundRequestTypeSet.has(value);
}

export function isBackgroundRequestEnvelope(value: unknown): value is SpectraRequestEnvelope {
	if (!isProtocolRecord(value) || !hasValidRequestEnvelopeBase(value)) {
		return false;
	}
	const type = value.type;
	if (!isBackgroundRequestType(type)) return false;
	const guard = BACKGROUND_REQUEST_GUARDS[type];
	return guard?.(value.payload) === true
		&& hasCanonicalRequestContext(type, value);
}

export function isBackgroundEventEnvelope(value: unknown): value is SpectraEventEnvelope {
	if (!isProtocolRecord(value) || !hasValidEventEnvelopeBase(value)) return false;
	if (value.type === 'spectra.control.snapshot.changed') {
		return isControlSnapshot(value.payload)
			&& value.tabId === value.payload.tabId
			&& value.documentId === value.payload.documentId
			&& value.generation === value.payload.generation;
	}
	if (value.type === 'spectra.audio.session.changed') {
		return isAudioSessionSnapshot(value.payload)
			&& value.tabId === value.payload.tabId
			&& value.documentId === value.payload.documentId
			&& value.generation === value.payload.generation;
	}
	return false;
}

function isBackgroundResponseData(type: SpectraRequestType, value: unknown): boolean {
	switch (type) {
		case 'spectra.control.snapshot.get': return value === null || isControlSnapshot(value);
		case 'spectra.control.intent.execute':
		case 'spectra.control.intent.submit': return isControlApplyAck(value);
		case 'spectra.control.operation.execute':
		case 'spectra.control.operation.submit': return isControlOperationAck(value);
		case 'spectra.control.actual.read': return isControlReadResult(value);
	case 'spectra.audio.runtime.get':
		case 'spectra.audio.runtime.configure':
		case 'spectra.audio.visualizer.demand.set': return isAudioRuntimeStatus(value);
		case 'spectra.audio.visualizer.get': return isVisualizerFrameResult(value);
		case 'spectra.audio.config.get': return isAudioConfig(value);
		case 'spectra.audio.policy.get': return isAudioSitePolicy(value);
		case 'spectra.audio.route.get':
		case 'spectra.audio.route.record': return isMediaRouteDecision(value);
		case 'spectra.audio.page-scale.record': return isProtocolRecord(value) && value.recorded === true;
		case 'spectra.audio.session.get':
		case 'spectra.audio.session.current': return value === null || isAudioSessionSnapshot(value);
		case 'spectra.audio.session.publish': return isAudioSessionSnapshot(value);
		case 'spectra.settings.get':
		case 'spectra.settings.patch': return isSettingsSnapshot(value);
		case 'spectra.settings.ui.get':
		case 'spectra.settings.ui.patch': return isSettingsUiSnapshot(value);
		case 'spectra.registry.get': return isRegistrySnapshot(value);
		case 'spectra.registry.add':
		case 'spectra.registry.mark-probed': return isRegistryAddResult(value);
		case 'spectra.registry.remove': return isRegistryRemoveResult(value);
		case 'spectra.registry.query': return isRegistryQueryResult(value);
		case 'spectra.hotkey-target.get':
		case 'spectra.hotkey-target.set': return isHotkeyTargetState(value);
		default: return true;
	}
}

export function isBackgroundResponse<T extends SpectraRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<T> {
	if (isRpcFailureResult(value)) return isRpcError(value.error);
	return isRpcSuccessResult(value) && isBackgroundResponseData(type, value.data);
}

export function rpcSuccess<T>(data: T): RpcResult<T> {
	return { ok: true, data };
}

export function rpcFailure(
	code: string,
	message: string,
	retryable = false,
): RpcResult<never> {
	return { ok: false, error: { code, message, retryable } };
}

export const RPC_INVALID_REQUEST = 'invalid_request' as const;

export interface BackgroundRequestContext {
	tabId?: number;
	documentId?: string;
	generation?: number;
}

function createRequestId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

export function createBackgroundEnvelope<T extends SpectraRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: BackgroundRequestContext = {},
): SpectraRequestEnvelope<T> {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: createRequestId(),
		type,
		payload,
		...context,
	} as SpectraRequestEnvelope<T>;
}

// One bounded entry per canonical route, never per URL, tab, document or request.
// Busy duration describes a continuously occupied route, not an individual call.
const tabRequestActivity = new Map<SpectraRequestType, { pending: number; startedAt: number }>();

export function getBackgroundTabRequestDiagnostics(): Record<string, number> {
	const result: Record<string, number> = {};
	for (const [type, activity] of tabRequestActivity) {
		result[`contentRpc:${type}:pending`] = activity.pending;
		result[`contentRpc:${type}:busyMs`] = Math.max(0, performance.now() - activity.startedAt);
	}
	return result;
}

export async function sendBackgroundTabRequestOnce<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<BackgroundRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	const message = createBackgroundEnvelope(type, payload, { ...context, tabId });
	const activity = tabRequestActivity.get(type) ?? { pending: 0, startedAt: performance.now() };
	activity.pending++;
	tabRequestActivity.set(type, activity);
	try {
		const response: unknown = context.documentId
			? await chrome.tabs.sendMessage(tabId, message, { documentId: context.documentId })
			: await chrome.tabs.sendMessage(tabId, message);
		if (!isBackgroundResponse(type, response)) {
			throw new Error(
				`Content host returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} response for ${type}`,
			);
		}
		return response;
	} finally {
		activity.pending--;
		if (activity.pending === 0) tabRequestActivity.delete(type);
	}
}
