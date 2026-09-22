// goal: versioned, runtime-validated SPECTRA RPC contracts

import {
	isAudioCaptureState,
	isAudioConfig,
	isAudioRuntimeStatus,
	isAudioSessionSnapshot,
	type AudioCaptureState,
	type AudioConfig,
	type AudioRuntimeStatus,
	type AudioSessionPhase,
	type AudioSessionSnapshot,
	type SpectraAudioMode,
} from './audio.contracts.js';
import { isFiniteControlValue } from './control-value-limits.js';
import {
	isCaptureAdmission,
	type CaptureAdmission,
} from './capture-admission.contracts.js';
import {
	isGlobalSettings,
	isAudioSitePolicy,
	isHotkeySettings,
	isSettingsPatchRequest,
	isSettingsSnapshot,
	type GlobalSettings,
	type AudioSitePolicy,
	type SettingsPatchRequest,
	type SettingsSnapshot,
} from './settings.contracts.js';
import {
	isSettingsUiPatchRequest,
	isSettingsUiSnapshot,
	type SettingsUiPatchRequest,
	type SettingsUiSnapshot,
} from './settings-ui.contracts.js';
import {
	isRegistryAddResult,
	isRegistryAddPayload,
	isRegistryQueryResult,
	isRegistryQueryPayload,
	isRegistryRemoveResult,
	isRegistryRemovePayload,
	isRegistryRecordPayload,
	isRegistrySnapshot,
	isMediaRouteChangedEvent,
	isMediaRouteDecision,
	isMediaRouteRecordRequest,
	isMediaRouteRulesSnapshot,
	isMediaRouteRuleUpsertPayload,
	type MediaRoute,
	type MediaRouteChangedEvent,
	type MediaRouteDecision,
	type MediaRouteRecordRequest,
	type MediaRouteRulesSnapshot,
	type MediaRouteRuleUpsertPayload,
	type RegistryAddResult,
	type RegistryQueryResult,
	type RegistryRemoveResult,
	type RegistrySnapshot,
} from './media-route.contracts.js';
import {
	HOTKEY_ACTIONS,
	type HotkeyAction,
	type HotkeySettings,
	type SpectraHotkeyActualFeedback,
} from './hotkeys.contracts.js';
import {
	isRemotePublicSession,
	isRemoteSessionToken,
	type RemotePublicSession,
	type RemoteSessionChangedEvent,
	type RemoteSessionClosedEvent,
	type RemoteSessionStatus,
} from './remote.contracts.js';
import {
	isHotkeyTargetState,
	type HotkeyTargetState,
} from './hotkey-target.contracts.js';
import {
	isControlApplyAck,
	isControlIntent,
	isControlOperationAck,
	isControlOperationIntent,
	isControlOperationRequest,
	isControlSnapshot,
	isControlSubmitRequest,
	isControlReadRequest,
	isControlReadResult,
	isMediaTarget,
	type ControlApplyAck,
	type ControlIntent,
	type ControlOperationAck,
	type ControlOperationIntent,
	type ControlOperationRequest,
	type ControlSnapshot,
	type ControlSubmitRequest,
	type ControlReadRequest,
	type ControlReadResult,
	type MediaTarget,
} from './control.contracts.js';
import type { SpectraDefaultHotkeyTriggerPayload } from './spectra.bootstrap.js';
import {
	isAudioVisualizerDemandPayload,
	isVisualizerBatchPayload,
	isVisualizerBatchResult,
	isVisualizerFrameResult,
	type AudioVisualizerDemandPayload,
	type VisualizerBatchPayload,
	type VisualizerBatchResult,
	type VisualizerFrameResult,
} from './visualizer.contracts.js';
import type { SPECTRA_PROTOCOL_VERSION } from './spectra.protocol-primitives.js';
import {
	isContentBootstrapHelloPayload,
	isContentRuntimeEnsurePayload,
	isContentRuntimeReleasePayload,
	isContentRuntimeRevisionPayload,
	isContentSourceReleasedPayload,
	isContentTargetChangedPayload,
	isAudioCaptureSetPayload,
	isAudioConfigPayload,
	isAudioSessionGetPayload,
	isAudioSessionPublishPayload,
	hasCanonicalRequestContext,
	isRemoteSessionClosePayload,
	isRemoteSessionPayload,
	isScreenshotCapturePayload,
	isTabIdPayload,
	isTabMediaReportPayload,
	isUiOpenPayload,
	isUserScriptPayload,
} from './spectra.background-runtime.js';
import { isSpectraDefaultHotkeyTriggerPayload } from './spectra.bootstrap.js';
import {
	hasValidEventEnvelopeBase,
	hasValidRequestEnvelopeBase,
	hasOnlyProtocolKeys as hasOnlyKeys,
	isDocumentId,
	isEmptyPayload,
	isFiniteInRange,
	isNonNegativeInteger,
	isOptionalFiniteInRange,
	isPositiveInteger,
	isProtocolRecord as isRecord,
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
	isRuntimeRevision,
	type RpcResult,
} from './spectra.protocol-primitives.js';

export {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
} from './spectra.bootstrap.js';
export { SPECTRA_PROTOCOL_VERSION } from './spectra.protocol-primitives.js';
export type { RpcError, RpcResult } from './spectra.protocol-primitives.js';

export type ContentRuntimeLeaseReason =
	| 'control'
	| 'restore'
	| 'hotkey'
	| 'remote'
	| 'observation'
	| 'visualizer';

export interface ContentRuntimeSourceOwnership {
	target: MediaTarget;
	markerCount: number;
	abActive: boolean;
}

export interface ContentRuntimeStatus {
	bootstrapRevision: string;
	runtimeRevision: string | null;
	ready: boolean;
	ownedSources: ContentRuntimeSourceOwnership[];
}

export interface ContentRuntimeReadyResult {
	documentId: string;
	runtimeRevision: string;
	ready: true;
}

export interface ContentRuntimeDocumentIdentity {
	documentId: string;
	frameId: 0;
}

export interface AudioSessionFlushResult {
	flushed: true;
}

export interface AudioSessionPublishPayload {
	config: AudioConfig;
	desiredMode: SpectraAudioMode;
	actualMode: SpectraAudioMode;
	phase: AudioSessionPhase;
	lastError: string | null;
	userInteracted: boolean;
}

export interface AudioConfigSavedResult {
	saved: true;
}

export interface TabPinnedResult {
	pinned: boolean;
}

export interface TabMutedResult {
	muted: boolean;
}

export interface UiOpenedResult {
	opened: true;
}

export interface NavigationChangedEvent {
	url: string;
}

export interface SpectraContentSettings extends GlobalSettings {
	osdMessages: {
		muted: string;
		corsAutoAdded: string;
		corsAddedSafe: string;
		corsCorrectedSafe: string;
	};
}

export interface MediaStateResult {
	playing: boolean;
	speed: number;
	pipActive: boolean;
	preservePitch: boolean;
}

export interface TimeMarkerResult {
	id: string;
	time: number;
	label: string;
}

export interface VideoFilterPayload {
	brightness?: number;
	contrast?: number;
	saturate?: number;
	grayscale?: boolean;
	invert?: boolean;
}

export interface ScreenshotCapturePayload {
	captureToken: string;
	rect: {
		x: number;
		y: number;
		width: number;
		height: number;
		viewportWidth: number;
		viewportHeight: number;
	};
}

export interface ScreenshotResult {
	saved: true;
	method: 'capture-visible-tab';
	width: number;
	height: number;
}

export interface SpectraRequestMap {
	'spectra.content.bootstrap.hello': {
		payload: { bootstrapRevision: string };
		response: { accepted: true; runtimeRevision: string | null };
	};
	'spectra.content.runtime.status': {
		payload: Record<string, never>;
		response: ContentRuntimeStatus;
	};
	'spectra.content.runtime.identity': {
		payload: Record<string, never>;
		response: ContentRuntimeDocumentIdentity;
	};
	'spectra.content.runtime.ensure': {
		payload: {
			tabId: number;
			documentId?: string;
			reason: ContentRuntimeLeaseReason;
			capability?: string;
		};
		response: ContentRuntimeReadyResult;
	};
	'spectra.content.runtime.ready': {
		payload: { runtimeRevision: string };
		response: { accepted: true };
	};
	'spectra.content.runtime.release': {
		payload: {
			runtimeRevision: string;
			tabId?: number;
			documentId?: string;
			reason?: ContentRuntimeLeaseReason;
			capability?: string;
		};
		response: { accepted: true };
	};
	'spectra.content.default-hotkey.trigger': {
		payload: SpectraDefaultHotkeyTriggerPayload;
		response: { accepted: true };
	};
	'spectra.content.source.released': {
		payload: { target: MediaTarget };
		response: { accepted: true };
	};
	'spectra.content.target.changed': {
		payload: { target: MediaTarget };
		response: { accepted: true };
	};
	'spectra.control.snapshot.get': {
		payload: { tabId: number };
		response: ControlSnapshot | null;
	};
	'spectra.control.intent.submit': {
		payload: ControlSubmitRequest;
		response: ControlApplyAck;
	};
	'spectra.control.intent.execute': {
		payload: ControlIntent;
		response: ControlApplyAck;
	};
	'spectra.control.operation.submit': {
		payload: ControlOperationRequest;
		response: ControlOperationAck;
	};
	'spectra.control.operation.execute': {
		payload: ControlOperationIntent;
		response: ControlOperationAck;
	};
	'spectra.control.actual.read': {
		payload: ControlReadRequest;
		response: ControlReadResult;
	};
	'spectra.control.page.scale.probe': {
		payload: Record<string, never>;
		response: { supported: boolean };
	};
	'spectra.content.settings.get': {
		payload: Record<string, never>;
		response: SpectraContentSettings;
	};
	'spectra.content.inject': {
		payload: { tabId: number };
		response: { injected: boolean };
	};
	'spectra.settings.get': {
		payload: Record<string, never>;
		response: SettingsSnapshot;
	};
	'spectra.settings.patch': {
		payload: SettingsPatchRequest;
		response: SettingsSnapshot;
	};
	'spectra.settings.ui.get': {
		payload: Record<string, never>;
		response: SettingsUiSnapshot;
	};
	'spectra.settings.ui.patch': {
		payload: SettingsUiPatchRequest;
		response: SettingsUiSnapshot;
	};
	'spectra.settings.flush': {
		payload: Record<string, never>;
		response: AudioSessionFlushResult;
	};
	'spectra.hotkeys.get': {
		payload: Record<string, never>;
		response: HotkeySettings;
	};
	'spectra.registry.get': {
		payload: Record<string, never>;
		response: RegistrySnapshot;
	};
	'spectra.registry.add': {
		payload: { domain: string; route: MediaRoute; force?: boolean };
		response: RegistryAddResult;
	};
	'spectra.registry.remove': {
		payload: { fingerprint: string };
		response: RegistryRemoveResult;
	};
	'spectra.registry.query': {
		payload: { domain: string; fingerprint: string };
		response: RegistryQueryResult;
	};
	'spectra.registry.mark-probed': {
		payload: { domain: string; fingerprint: string; route: MediaRoute; force?: boolean };
		response: RegistryAddResult;
	};
	'spectra.media-route.rules.get': {
		payload: Record<string, never>;
		response: MediaRouteRulesSnapshot;
	};
	'spectra.media-route.rules.upsert': {
		payload: MediaRouteRuleUpsertPayload;
		response: MediaRouteRulesSnapshot;
	};
	'spectra.media-route.rules.remove': {
		payload: { fingerprint: string };
		response: MediaRouteRulesSnapshot;
	};
	'spectra.hotkey-target.get': {
		payload: Record<string, never>;
		response: HotkeyTargetState;
	};
	'spectra.hotkey-target.set': {
		payload: HotkeyTargetState;
		response: HotkeyTargetState;
	};
	'spectra.remote.session.get': {
		payload: { tabId: number };
		response: RemoteSessionStatus;
	};
	'spectra.remote.session.create': {
		payload: { tabId: number };
		response: RemotePublicSession;
	};
	'spectra.remote.session.close': {
		payload: { tabId: number; sessionId: string };
		response: { closed: true };
	};
	'spectra.user-script.execute': {
		payload: { script: string };
		response: { executed: true };
	};
	'spectra.audio.config.get': {
		payload: Record<string, never>;
		response: AudioConfig;
	};
	'spectra.audio.policy.get': {
		payload: Record<string, never>;
		response: AudioSitePolicy;
	};
	'spectra.audio.route.get': {
		payload: Record<string, never>;
		response: MediaRouteDecision;
	};
	'spectra.audio.route.record': {
		payload: MediaRouteRecordRequest;
		response: MediaRouteDecision;
	};
	'spectra.audio.page-scale.record': {
		payload: { supported: boolean };
		response: { recorded: true };
	};
	'spectra.audio.config.set': {
		payload: { config: AudioConfig };
		response: AudioConfigSavedResult;
	};
	'spectra.audio.runtime.get': {
		payload: Record<string, never>;
		response: AudioRuntimeStatus;
	};
	'spectra.audio.runtime.configure': {
		payload: { config: AudioConfig };
		response: AudioRuntimeStatus;
	};
	'spectra.audio.session.get': {
		payload: { tabId: number };
		response: AudioSessionSnapshot | null;
	};
	'spectra.audio.session.current': {
		payload: Record<string, never>;
		response: AudioSessionSnapshot | null;
	};
	'spectra.audio.session.publish': {
		payload: AudioSessionPublishPayload;
		response: AudioSessionSnapshot;
	};
	'spectra.audio.session.flush': {
		payload: Record<string, never>;
		response: AudioSessionFlushResult;
	};
	'spectra.audio.capture.set': {
		payload: AudioCaptureTransitionPayload;
		response: AudioCaptureTransitionResult;
	};
	'spectra.audio.capture.config': {
		payload: { config: AudioConfig };
		response: AudioCaptureState;
	};
	'spectra.audio.visualizer.batch': {
		payload: VisualizerBatchPayload;
		response: VisualizerBatchResult;
	};
	'spectra.audio.visualizer.get': {
		payload: Record<string, never>;
		response: VisualizerFrameResult;
	};
	'spectra.audio.visualizer.demand.set': {
		payload: AudioVisualizerDemandPayload;
		response: AudioRuntimeStatus;
	};
	'spectra.hotkey.trigger': {
		payload: { action: HotkeyAction };
		response: { handled: true };
	};
	'spectra.media.state.get': {
		payload: Record<string, never>;
		response: MediaStateResult;
	};
	'spectra.media.play.toggle': {
		payload: Record<string, never>;
		response: { playing: boolean };
	};
	'spectra.media.pip.toggle': {
		payload: Record<string, never>;
		response: { active: boolean };
	};
	'spectra.media.speed.set': {
		payload: { speed?: number; delta?: number; preservePitch?: boolean };
		response: { speed: number; preservePitch: boolean };
	};
	'spectra.video.rotate': {
		payload: { delta: 90 | -90 };
		response: { rotation: number };
	};
	'spectra.video.mirror.toggle': {
		payload: Record<string, never>;
		response: { mirrored: boolean };
	};
	'spectra.video.screenshot': {
		payload: Record<string, never>;
		response: ScreenshotResult;
	};
	'spectra.screenshot.capture-visible': {
		payload: ScreenshotCapturePayload;
		response: ScreenshotResult;
	};
	'spectra.screenshot.target.verify': {
		payload: { captureToken: string };
		response: { valid: true };
	};
	'spectra.video.fullscreen.toggle': {
		payload: Record<string, never>;
		response: { active: boolean };
	};
	'spectra.video.crop.toggle': {
		payload: Record<string, never>;
		response: { cropped: boolean };
	};
	'spectra.video.seek': {
		payload: { delta: number };
		response: { currentTime: number };
	};
	'spectra.video.filter.set': {
		payload: VideoFilterPayload;
		response: { applied: boolean };
	};
	'spectra.video.filter.reset': {
		payload: Record<string, never>;
		response: { reset: boolean };
	};
	'spectra.video.dim.toggle': {
		payload: { enabled?: boolean; opacity?: number };
		response: { active: boolean; opacity: number };
	};
	'spectra.video.ab.a.set': {
		payload: Record<string, never>;
		response: { pointA: number | null };
	};
	'spectra.video.ab.b.set': {
		payload: Record<string, never>;
		response: { pointB: number | null; looping: boolean };
	};
	'spectra.video.ab.clear': {
		payload: Record<string, never>;
		response: { cleared: true };
	};
	'spectra.video.ab.get': {
		payload: Record<string, never>;
		response: { pointA: number | null; pointB: number | null; looping: boolean };
	};
	'spectra.video.marker.add': {
		payload: { label?: string };
		response: { marker: TimeMarkerResult | null };
	};
	'spectra.video.marker.remove': {
		payload: { id: string };
		response: { removed: boolean };
	};
	'spectra.video.marker.jump': {
		payload: { id: string };
		response: { jumped: boolean; time: number };
	};
	'spectra.video.marker.list': {
		payload: Record<string, never>;
		response: { markers: TimeMarkerResult[] };
	};
	'spectra.tab.media.report': {
		payload: { hasMediaElement: boolean; userInteracted: boolean; reportRevision?: number; hasSubframes?: boolean };
		response: { reported: true };
	};
	'spectra.tab.visible.list': {
		payload: Record<string, never>;
		response: VisibleTabsResult;
	};
	// Waits for the current background inventory sweep to settle (bounded by the
	// scan budget) before projecting the known media tabs. Consumed by the popup
	// after an instant list read so an open popup converges without a reopen.
	'spectra.tab.visible.settle': {
		payload: Record<string, never>;
		response: VisibleTabsResult;
	};
	'spectra.tab.pinned.toggle': {
		payload: Record<string, never>;
		response: TabPinnedResult;
	};
	'spectra.tab.muted.toggle': {
		payload: Record<string, never>;
		response: TabMutedResult;
	};
	'spectra.ui.open': {
		payload: { view: 'options' | 'popup' };
		response: UiOpenedResult;
	};
}

export type AudioCaptureTransitionPayload =
	| {
		enabled: true;
		config: AudioConfig;
		admission: CaptureAdmission;
		requestContinuation?: never;
	}
	| {
		enabled: false;
		config: AudioConfig;
		admission?: never;
		requestContinuation?: boolean;
	};

export type AudioCaptureTransitionResult = AudioCaptureState & {
	continuationAdmission?: CaptureAdmission;
};

export interface SpectraEventMap {
	'spectra.control.snapshot.changed': ControlSnapshot;
	'spectra.content.settings.changed': SpectraContentSettings;
	'spectra.settings.changed': SettingsSnapshot;
	'spectra.settings.ui.changed': SettingsUiSnapshot;
	'spectra.hotkeys.changed': HotkeySettings;
	'spectra.hotkey.target.feedback': {
		action: HotkeyAction;
		targetTabId: number;
		targetTitle: string;
		targetHostname: string;
		gesture?: string;
		feedback?: SpectraHotkeyActualFeedback;
	};
	'spectra.navigation.changed': NavigationChangedEvent;
	'spectra.remote.session.changed': RemoteSessionChangedEvent;
	'spectra.remote.session.closed': RemoteSessionClosedEvent;
	'spectra.audio.session.changed': AudioSessionSnapshot;
	'spectra.audio.capture.changed': AudioCaptureState;
	'spectra.audio.route.changed': MediaRouteChangedEvent;
}

export type SpectraRequestType = keyof SpectraRequestMap;
export type SpectraEventType = keyof SpectraEventMap;
export type SpectraRequestPayload<T extends SpectraRequestType> = SpectraRequestMap[T]['payload'];
export type SpectraEventPayload<T extends SpectraEventType> = SpectraEventMap[T];
export type SpectraResponseData<T extends SpectraRequestType> = SpectraRequestMap[T]['response'];
export type SpectraResponse<T extends SpectraRequestType = SpectraRequestType> = RpcResult<SpectraResponseData<T>>;

interface SpectraContextFields {
	tabId?: number;
	documentId?: string;
	generation?: number;
}

interface SpectraRequestBase extends SpectraContextFields {
	protocolVersion: typeof SPECTRA_PROTOCOL_VERSION;
	requestId: string;
}

interface SpectraEventBase extends SpectraContextFields {
	protocolVersion: typeof SPECTRA_PROTOCOL_VERSION;
}

type SpectraRequestEnvelopeFor<T extends SpectraRequestType> = SpectraRequestBase & {
	type: T;
	payload: SpectraRequestPayload<T>;
};

type SpectraEventEnvelopeFor<T extends SpectraEventType> = SpectraEventBase & {
	type: T;
	payload: SpectraEventPayload<T>;
} & (T extends 'spectra.audio.session.changed'
	? Required<Pick<SpectraContextFields, 'tabId' | 'documentId' | 'generation'>>
	: T extends 'spectra.audio.capture.changed'
		? Required<Pick<SpectraContextFields, 'tabId' | 'documentId' | 'generation'>>
	: T extends 'spectra.navigation.changed'
		? Required<Pick<SpectraContextFields, 'tabId' | 'documentId'>>
	: T extends 'spectra.hotkey.target.feedback'
		? Required<Pick<SpectraContextFields, 'tabId'>>
	: T extends 'spectra.remote.session.changed' | 'spectra.remote.session.closed'
		? Required<Pick<SpectraContextFields, 'tabId'>>
		: unknown);

// note: mapped unions preserve the type/payload relationship when T is the default union
export type SpectraRequestEnvelope<T extends SpectraRequestType = SpectraRequestType> = {
	[K in T]: SpectraRequestEnvelopeFor<K>;
}[T];

// goal: preserves request type, payload, and response data as one compile-time exchange
export type SpectraExchange<T extends SpectraRequestType = SpectraRequestType> = {
	[K in T]: {
		request: SpectraRequestEnvelopeFor<K>;
		response: SpectraResponse<K>;
	};
}[T];

export type SpectraEventEnvelope<T extends SpectraEventType = SpectraEventType> = {
	[K in T]: SpectraEventEnvelopeFor<K>;
}[T];

type RuntimeGuard<T> = (value: unknown) => value is T;

const AUDIO_CAPTURE_TRANSITION_RESULT_KEYS = new Set([
	'tabId', 'generation', 'phase', 'active', 'actualMode', 'lastError',
	'actualConfig', 'continuationAdmission',
]);
const CONTENT_SETTINGS_KEYS = new Set([
	'osdEnabled',
	'visualizerEnabled',
	'lang',
	'themeMode',
	'pauseRetentionSeconds',
	'osdMessages',
]);
const OSD_MESSAGES_KEYS = new Set([
	'muted',
	'corsAutoAdded',
	'corsAddedSafe',
	'corsCorrectedSafe',
]);
const HOTKEY_TRIGGER_PAYLOAD_KEYS = new Set(['action']);
const HOTKEY_TARGET_FEEDBACK_KEYS = new Set([
	'action', 'targetTabId', 'targetTitle', 'targetHostname', 'gesture', 'feedback',
]);
const HOTKEY_VOLUME_FEEDBACK_KEYS = new Set(['kind', 'value', 'volumeState']);
const HOTKEY_SPEED_FEEDBACK_KEYS = new Set(['kind', 'value']);
const MEDIA_SPEED_PAYLOAD_KEYS = new Set(['speed', 'delta', 'preservePitch']);
const VIDEO_ROTATE_PAYLOAD_KEYS = new Set(['delta']);
const VIDEO_SEEK_PAYLOAD_KEYS = new Set(['delta']);
const VIDEO_FILTER_PAYLOAD_KEYS = new Set([
	'brightness',
	'contrast',
	'saturate',
	'grayscale',
	'invert',
]);
const VIDEO_DIM_PAYLOAD_KEYS = new Set(['enabled', 'opacity']);
const SCREENSHOT_TARGET_VERIFY_PAYLOAD_KEYS = new Set(['captureToken']);
const MARKER_LABEL_PAYLOAD_KEYS = new Set(['label']);
const MARKER_ID_PAYLOAD_KEYS = new Set(['id']);
const ACCEPTED_RESULT_KEYS = new Set(['accepted']);
const BOOTSTRAP_HELLO_RESULT_KEYS = new Set(['accepted', 'runtimeRevision']);
const CONTENT_RUNTIME_STATUS_KEYS = new Set(['bootstrapRevision', 'runtimeRevision', 'ready', 'ownedSources']);
const CONTENT_RUNTIME_SOURCE_OWNERSHIP_KEYS = new Set(['target', 'markerCount', 'abActive']);
const CONTENT_RUNTIME_IDENTITY_KEYS = new Set(['documentId', 'frameId']);
const CONTENT_RUNTIME_READY_RESULT_KEYS = new Set(['documentId', 'runtimeRevision', 'ready']);
const AUDIO_SESSION_FLUSH_RESULT_KEYS = new Set(['flushed']);
const REMOTE_SESSION_STATUS_KEYS = new Set(['session', 'connected']);
const CLOSED_RESULT_KEYS = new Set(['closed']);
const EXECUTED_RESULT_KEYS = new Set(['executed']);
const SAVED_RESULT_KEYS = new Set(['saved']);
const PINNED_RESULT_KEYS = new Set(['pinned']);
const MUTED_RESULT_KEYS = new Set(['muted']);
const OPENED_RESULT_KEYS = new Set(['opened']);
const INJECTED_RESULT_KEYS = new Set(['injected']);
const REPORTED_RESULT_KEYS = new Set(['reported']);
const HANDLED_RESULT_KEYS = new Set(['handled']);
const TABS_RESULT_KEYS = new Set(['tabs', 'coverage']);
const MEDIA_COVERAGE_KEYS = new Set([
	'status', 'total', 'examined', 'pending', 'failed', 'denied', 'stale', 'unknown',
]);
const PLAYING_RESULT_KEYS = new Set(['playing']);
const ACTIVE_RESULT_KEYS = new Set(['active']);
const MEDIA_STATE_RESULT_KEYS = new Set(['playing', 'speed', 'pipActive', 'preservePitch']);
const MEDIA_SPEED_RESULT_KEYS = new Set(['speed', 'preservePitch']);
const ROTATION_RESULT_KEYS = new Set(['rotation']);
const MIRRORED_RESULT_KEYS = new Set(['mirrored']);
const SCREENSHOT_RESULT_KEYS = new Set(['saved', 'method', 'width', 'height']);
const SCREENSHOT_TARGET_VERIFY_RESULT_KEYS = new Set(['valid']);
const CROPPED_RESULT_KEYS = new Set(['cropped']);
const CURRENT_TIME_RESULT_KEYS = new Set(['currentTime']);
const APPLIED_RESULT_KEYS = new Set(['applied']);
const RESET_RESULT_KEYS = new Set(['reset']);
const DIM_RESULT_KEYS = new Set(['active', 'opacity']);
const POINT_A_RESULT_KEYS = new Set(['pointA']);
const POINT_B_RESULT_KEYS = new Set(['pointB', 'looping']);
const CLEARED_RESULT_KEYS = new Set(['cleared']);
const AB_STATE_RESULT_KEYS = new Set(['pointA', 'pointB', 'looping']);
const MARKER_RESULT_KEYS = new Set(['marker']);
const MARKER_KEYS = new Set(['id', 'time', 'label']);
const REMOVED_RESULT_KEYS = new Set(['removed']);
const JUMP_RESULT_KEYS = new Set(['jumped', 'time']);
const MARKERS_RESULT_KEYS = new Set(['markers']);
const REMOTE_SESSION_CHANGED_KEYS = new Set(['tabId', 'sessionId', 'connected']);
const REMOTE_SESSION_CLOSED_KEYS = new Set(['tabId', 'sessionId']);
const NAVIGATION_CHANGED_KEYS = new Set(['url']);

function isContentSettings(value: unknown): value is SpectraContentSettings {
	if (!isRecord(value) || !hasOnlyKeys(value, CONTENT_SETTINGS_KEYS)) return false;
	const { osdMessages, ...globalSettings } = value;
	return isGlobalSettings(globalSettings)
		&& isRecord(osdMessages)
		&& hasOnlyKeys(osdMessages, OSD_MESSAGES_KEYS)
		&& typeof osdMessages.muted === 'string'
		&& osdMessages.muted.length > 0
		&& osdMessages.muted.length <= 128
		&& typeof osdMessages.corsAutoAdded === 'string'
		&& osdMessages.corsAutoAdded.length > 0
		&& osdMessages.corsAutoAdded.length <= 256
		&& typeof osdMessages.corsAddedSafe === 'string'
		&& osdMessages.corsAddedSafe.length > 0
		&& osdMessages.corsAddedSafe.length <= 256
		&& typeof osdMessages.corsCorrectedSafe === 'string'
		&& osdMessages.corsCorrectedSafe.length > 0
		&& osdMessages.corsCorrectedSafe.length <= 256;
}

const LEGACY_UNSUPPORTED_HOTKEY_ACTIONS = new Set<HotkeyAction>([
	'pitch_up',
	'pitch_down',
	'pitch_reset',
]);
const HOTKEY_ACTION_SET = new Set<HotkeyAction>(
	HOTKEY_ACTIONS.filter((action) => !LEGACY_UNSUPPORTED_HOTKEY_ACTIONS.has(action)),
);

function isHotkeyTriggerPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.hotkey.trigger'> {
	return isRecord(value)
		&& hasOnlyKeys(value, HOTKEY_TRIGGER_PAYLOAD_KEYS)
		&& typeof value.action === 'string'
		&& HOTKEY_ACTION_SET.has(value.action as HotkeyAction);
}

function isHotkeyTargetFeedback(
	value: unknown,
): value is SpectraEventPayload<'spectra.hotkey.target.feedback'> {
	return isRecord(value)
		&& hasOnlyKeys(value, HOTKEY_TARGET_FEEDBACK_KEYS)
		&& typeof value.action === 'string'
		&& HOTKEY_ACTION_SET.has(value.action as HotkeyAction)
		&& isPositiveInteger(value.targetTabId)
		&& typeof value.targetTitle === 'string'
		&& value.targetTitle.length > 0
		&& value.targetTitle.length <= 512
		&& typeof value.targetHostname === 'string'
		&& value.targetHostname.length > 0
		&& value.targetHostname.length <= 253
		&& (value.gesture === undefined
			|| typeof value.gesture === 'string'
				&& value.gesture.length > 0
				&& value.gesture.length <= 128)
		&& (value.feedback === undefined || (
			isRecord(value.feedback)
			&& (value.feedback.kind === 'volume'
				? hasOnlyKeys(value.feedback, HOTKEY_VOLUME_FEEDBACK_KEYS)
					&& isFiniteControlValue(value.feedback.value, 'volume')
					&& (value.feedback.volumeState === 'silent'
						|| value.feedback.volumeState === 'native'
						|| value.feedback.volumeState === 'capture')
				: value.feedback.kind === 'speed'
					&& hasOnlyKeys(value.feedback, HOTKEY_SPEED_FEEDBACK_KEYS)
					&& isFiniteControlValue(value.feedback.value, 'speed'))
		));
}

function isMediaSpeedPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.media.speed.set'> {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, MEDIA_SPEED_PAYLOAD_KEYS)
		|| !(value.speed === undefined || isFiniteControlValue(value.speed, 'speed'))
		|| !isOptionalFiniteInRange(value.delta, -15.9, 15.9)
		|| (value.preservePitch !== undefined && typeof value.preservePitch !== 'boolean')) return false;
	return (value.speed === undefined) !== (value.delta === undefined);
}

function isVideoRotatePayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.video.rotate'> {
	return isRecord(value)
		&& hasOnlyKeys(value, VIDEO_ROTATE_PAYLOAD_KEYS)
		&& (value.delta === 90 || value.delta === -90);
}

function isVideoSeekPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.video.seek'> {
	return isRecord(value)
		&& hasOnlyKeys(value, VIDEO_SEEK_PAYLOAD_KEYS)
		&& isFiniteInRange(value.delta, -86_400, 86_400);
}

function isScreenshotTargetVerifyPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.screenshot.target.verify'> {
	return isRecord(value)
		&& hasOnlyKeys(value, SCREENSHOT_TARGET_VERIFY_PAYLOAD_KEYS)
		&& typeof value.captureToken === 'string'
		&& value.captureToken.length > 0
		&& value.captureToken.length <= 128;
}

function isVideoFilterPayload(value: unknown): value is VideoFilterPayload {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, VIDEO_FILTER_PAYLOAD_KEYS)
		|| Object.keys(value).length === 0) return false;
	return isOptionalFiniteInRange(value.brightness, 0, 200)
		&& isOptionalFiniteInRange(value.contrast, 0, 200)
		&& isOptionalFiniteInRange(value.saturate, 0, 200)
		&& (value.grayscale === undefined || typeof value.grayscale === 'boolean')
		&& (value.invert === undefined || typeof value.invert === 'boolean');
}

function isVideoDimPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.video.dim.toggle'> {
	return isRecord(value)
		&& hasOnlyKeys(value, VIDEO_DIM_PAYLOAD_KEYS)
		&& (value.enabled === undefined || typeof value.enabled === 'boolean')
		&& isOptionalFiniteInRange(value.opacity, 0, 1);
}

function isMarkerLabelPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.video.marker.add'> {
	return isRecord(value)
		&& hasOnlyKeys(value, MARKER_LABEL_PAYLOAD_KEYS)
		&& (value.label === undefined || (
			typeof value.label === 'string'
			&& value.label.length > 0
			&& value.label.length <= 256
		));
}

function isMarkerIdPayload(
	value: unknown,
): value is SpectraRequestPayload<'spectra.video.marker.remove' | 'spectra.video.marker.jump'> {
	return isRecord(value)
		&& hasOnlyKeys(value, MARKER_ID_PAYLOAD_KEYS)
		&& typeof value.id === 'string'
		&& /^m_[0-9a-f-]{36}$/iu.test(value.id);
}

function isAudioCaptureTransitionResult(
	value: unknown,
): value is AudioCaptureTransitionResult {
	if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CAPTURE_TRANSITION_RESULT_KEYS)) return false;
	const { continuationAdmission: _, ...state } = value;
	if (!isAudioCaptureState(state)) return false;
	if (value.continuationAdmission === undefined) return true;
	return value.active === false
		&& value.phase === 'idle'
		&& isCaptureAdmission(value.continuationAdmission)
		&& value.continuationAdmission.kind === 'capture-resume';
}

function isRemoteSessionStatus(value: unknown): value is RemoteSessionStatus {
	if (!isRecord(value) || !hasOnlyKeys(value, REMOTE_SESSION_STATUS_KEYS) || typeof value.connected !== 'boolean') {
		return false;
	}
	return value.session === null
		? value.connected === false
		: isRemotePublicSession(value.session) && value.connected === value.session.connected;
}

function isRemoteSessionChangedEvent(value: unknown): value is RemoteSessionChangedEvent {
	return isRecord(value)
		&& hasOnlyKeys(value, REMOTE_SESSION_CHANGED_KEYS)
		&& isPositiveInteger(value.tabId)
		&& typeof value.sessionId === 'string'
		&& isRemoteSessionToken(value.sessionId)
		&& typeof value.connected === 'boolean';
}

function isRemoteSessionClosedEvent(value: unknown): value is RemoteSessionClosedEvent {
	return isRecord(value)
		&& hasOnlyKeys(value, REMOTE_SESSION_CLOSED_KEYS)
		&& isPositiveInteger(value.tabId)
		&& typeof value.sessionId === 'string'
		&& isRemoteSessionToken(value.sessionId);
}

function isNavigationChangedEvent(value: unknown): value is NavigationChangedEvent {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, NAVIGATION_CHANGED_KEYS)
		|| typeof value.url !== 'string'
		|| value.url.length === 0
		|| value.url.length > 8192) return false;
	try {
		new URL(value.url);
		return true;
	} catch {
		return false;
	}
}

const REQUEST_PAYLOAD_GUARDS = {
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
	'spectra.control.intent.execute': isControlIntent,
	'spectra.control.operation.submit': isControlOperationRequest,
	'spectra.control.operation.execute': isControlOperationIntent,
	'spectra.control.actual.read': isControlReadRequest,
	'spectra.control.page.scale.probe': isEmptyPayload,
	'spectra.content.settings.get': isEmptyPayload,
	'spectra.content.inject': isTabIdPayload,
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
	'spectra.media-route.rules.get': isEmptyPayload,
	'spectra.media-route.rules.upsert': isMediaRouteRuleUpsertPayload,
	'spectra.media-route.rules.remove': isRegistryRemovePayload,
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
		return isRecord(value) && typeof value.supported === 'boolean';
	},
	'spectra.audio.config.set': isAudioConfigPayload,
	'spectra.audio.runtime.get': isEmptyPayload,
	'spectra.audio.runtime.configure': isAudioConfigPayload,
	'spectra.audio.session.get': isAudioSessionGetPayload,
	'spectra.audio.session.current': isEmptyPayload,
	'spectra.audio.session.publish': isAudioSessionPublishPayload,
	'spectra.audio.session.flush': isEmptyPayload,
	'spectra.audio.capture.set': isAudioCaptureSetPayload,
	'spectra.audio.capture.config': isAudioConfigPayload,
	'spectra.audio.visualizer.batch': isVisualizerBatchPayload,
	'spectra.audio.visualizer.get': isEmptyPayload,
	'spectra.audio.visualizer.demand.set': isAudioVisualizerDemandPayload,
	'spectra.hotkey.trigger': isHotkeyTriggerPayload,
	'spectra.media.state.get': isEmptyPayload,
	'spectra.media.play.toggle': isEmptyPayload,
	'spectra.media.pip.toggle': isEmptyPayload,
	'spectra.media.speed.set': isMediaSpeedPayload,
	'spectra.video.rotate': isVideoRotatePayload,
	'spectra.video.mirror.toggle': isEmptyPayload,
	'spectra.video.screenshot': isEmptyPayload,
	'spectra.screenshot.capture-visible': isScreenshotCapturePayload,
	'spectra.screenshot.target.verify': isScreenshotTargetVerifyPayload,
	'spectra.video.fullscreen.toggle': isEmptyPayload,
	'spectra.video.crop.toggle': isEmptyPayload,
	'spectra.video.seek': isVideoSeekPayload,
	'spectra.video.filter.set': isVideoFilterPayload,
	'spectra.video.filter.reset': isEmptyPayload,
	'spectra.video.dim.toggle': isVideoDimPayload,
	'spectra.video.ab.a.set': isEmptyPayload,
	'spectra.video.ab.b.set': isEmptyPayload,
	'spectra.video.ab.clear': isEmptyPayload,
	'spectra.video.ab.get': isEmptyPayload,
	'spectra.video.marker.add': isMarkerLabelPayload,
	'spectra.video.marker.remove': isMarkerIdPayload,
	'spectra.video.marker.jump': isMarkerIdPayload,
	'spectra.video.marker.list': isEmptyPayload,
	'spectra.tab.media.report': isTabMediaReportPayload,
	'spectra.tab.visible.list': isEmptyPayload,
	'spectra.tab.visible.settle': isEmptyPayload,
	'spectra.tab.pinned.toggle': isEmptyPayload,
	'spectra.tab.muted.toggle': isEmptyPayload,
	'spectra.ui.open': isUiOpenPayload,
} satisfies { [T in SpectraRequestType]: RuntimeGuard<SpectraRequestPayload<T>> };

function isBooleanFieldResult(
	value: unknown,
	keys: ReadonlySet<string>,
	field: string,
): boolean {
	return isRecord(value)
		&& hasOnlyKeys(value, keys)
		&& typeof value[field] === 'boolean';
}

function isMediaStateResult(value: unknown): value is MediaStateResult {
	return isRecord(value)
		&& hasOnlyKeys(value, MEDIA_STATE_RESULT_KEYS)
		&& typeof value.playing === 'boolean'
		&& isFiniteControlValue(value.speed, 'speed')
		&& typeof value.pipActive === 'boolean'
		&& typeof value.preservePitch === 'boolean';
}

function isMediaSpeedResult(
	value: unknown,
): value is SpectraResponseData<'spectra.media.speed.set'> {
	return isRecord(value)
		&& hasOnlyKeys(value, MEDIA_SPEED_RESULT_KEYS)
		&& isFiniteControlValue(value.speed, 'speed')
		&& typeof value.preservePitch === 'boolean';
}

// Shared response shape for instant list reads and settling convergence reads.
export interface VisibleTabsResult {
	tabs: number[];
	coverage?: {
		status: 'complete' | 'degraded';
		total: number;
		examined: number;
		pending: number;
		failed: number;
		denied: number;
		stale: number;
		unknown: number;
	};
}

function isVisibleTabsResult(
	value: unknown,
): value is VisibleTabsResult {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, TABS_RESULT_KEYS)
		|| !Array.isArray(value.tabs)
		|| value.tabs.length > 10_000) return false;
	const tabs = value.tabs;
	const hasCoverage = Object.hasOwn(value, 'coverage');
	if (hasCoverage && (!isRecord(value.coverage)
		|| !hasOnlyKeys(value.coverage, MEDIA_COVERAGE_KEYS)
		|| value.coverage.status !== 'complete' && value.coverage.status !== 'degraded')) return false;
	if (!hasCoverage) return tabs.every((tabId, index) => (
		isPositiveInteger(tabId) && tabs.indexOf(tabId) === index
	));
	if (!isRecord(value.coverage)) return false;
	for (const key of ['total', 'examined', 'pending', 'failed', 'denied', 'stale', 'unknown'] as const) {
		const count = value.coverage[key];
		if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 10_000) return false;
	}
	const total = Number(value.coverage.total);
	const examined = Number(value.coverage.examined);
	const pending = Number(value.coverage.pending);
	const failed = Number(value.coverage.failed);
	const denied = Number(value.coverage.denied);
	const stale = Number(value.coverage.stale);
	const unknown = Number(value.coverage.unknown);
	if (examined + failed !== total || pending + denied + stale + unknown !== failed
		|| (value.coverage.status === 'complete') !== (failed === 0)) return false;
	const unique = new Set<number>();
	for (const tabId of tabs) {
		if (!isPositiveInteger(tabId) || unique.has(tabId)) return false;
		unique.add(tabId);
	}
	return true;
}

function isScreenshotResult(
	value: unknown,
): value is SpectraResponseData<'spectra.video.screenshot'> {
	return isRecord(value)
		&& hasOnlyKeys(value, SCREENSHOT_RESULT_KEYS)
		&& value.saved === true
		&& value.method === 'capture-visible-tab'
		&& isFiniteInRange(value.width, 1, 100_000)
		&& isFiniteInRange(value.height, 1, 100_000);
}

function isNullableTime(value: unknown): value is number | null {
	return value === null || isFiniteInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isTimeMarker(value: unknown): value is TimeMarkerResult {
	return isRecord(value)
		&& hasOnlyKeys(value, MARKER_KEYS)
		&& typeof value.id === 'string'
		&& /^m_[0-9a-f-]{36}$/iu.test(value.id)
		&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER)
		&& typeof value.label === 'string'
		&& value.label.length > 0
		&& value.label.length <= 256;
}

function isMarkerResult(
	value: unknown,
): value is SpectraResponseData<'spectra.video.marker.add'> {
	return isRecord(value)
		&& hasOnlyKeys(value, MARKER_RESULT_KEYS)
		&& (value.marker === null || isTimeMarker(value.marker));
}

function isMarkersResult(
	value: unknown,
): value is SpectraResponseData<'spectra.video.marker.list'> {
	return isRecord(value)
		&& hasOnlyKeys(value, MARKERS_RESULT_KEYS)
		&& Array.isArray(value.markers)
		&& value.markers.length <= 10_000
		&& value.markers.every(isTimeMarker);
}

function isContentBootstrapHelloResult(
	value: unknown,
): value is SpectraResponseData<'spectra.content.bootstrap.hello'> {
	return isRecord(value)
		&& hasOnlyKeys(value, BOOTSTRAP_HELLO_RESULT_KEYS)
		&& value.accepted === true
		&& (value.runtimeRevision === null || isRuntimeRevision(value.runtimeRevision));
}

function isContentRuntimeStatus(
	value: unknown,
): value is SpectraResponseData<'spectra.content.runtime.status'> {
	return isRecord(value)
		&& hasOnlyKeys(value, CONTENT_RUNTIME_STATUS_KEYS)
		&& isRuntimeRevision(value.bootstrapRevision)
		&& (value.runtimeRevision === null || isRuntimeRevision(value.runtimeRevision))
		&& typeof value.ready === 'boolean'
		&& (!value.ready || value.runtimeRevision !== null)
		&& Array.isArray(value.ownedSources)
		&& value.ownedSources.length <= 2_000
		&& value.ownedSources.every((ownership) => isRecord(ownership)
			&& hasOnlyKeys(ownership, CONTENT_RUNTIME_SOURCE_OWNERSHIP_KEYS)
			&& isMediaTarget(ownership.target)
			&& isNonNegativeInteger(ownership.markerCount)
			&& ownership.markerCount <= 1_000
			&& typeof ownership.abActive === 'boolean');
}

function isContentRuntimeReadyResult(
	value: unknown,
): value is SpectraResponseData<'spectra.content.runtime.ensure'> {
	return isRecord(value)
		&& hasOnlyKeys(value, CONTENT_RUNTIME_READY_RESULT_KEYS)
		&& isDocumentId(value.documentId)
		&& isRuntimeRevision(value.runtimeRevision)
		&& value.ready === true;
}

function isContentRuntimeDocumentIdentity(
	value: unknown,
): value is SpectraResponseData<'spectra.content.runtime.identity'> {
	return isRecord(value)
		&& hasOnlyKeys(value, CONTENT_RUNTIME_IDENTITY_KEYS)
		&& isDocumentId(value.documentId)
		&& value.frameId === 0;
}

function isAcceptedResult(
	value: unknown,
): value is SpectraResponseData<
	| 'spectra.content.runtime.ready'
	| 'spectra.content.runtime.release'
	| 'spectra.content.default-hotkey.trigger'
> {
	return isRecord(value)
		&& hasOnlyKeys(value, ACCEPTED_RESULT_KEYS)
		&& value.accepted === true;
}

const RESPONSE_DATA_GUARDS = {
	'spectra.content.bootstrap.hello': isContentBootstrapHelloResult,
	'spectra.content.runtime.status': isContentRuntimeStatus,
	'spectra.content.runtime.identity': isContentRuntimeDocumentIdentity,
	'spectra.content.runtime.ensure': isContentRuntimeReadyResult,
	'spectra.content.runtime.ready': isAcceptedResult,
	'spectra.content.runtime.release': isAcceptedResult,
	'spectra.content.default-hotkey.trigger': isAcceptedResult,
	'spectra.content.source.released': isAcceptedResult,
	'spectra.content.target.changed': isAcceptedResult,
	'spectra.control.snapshot.get': (
		value: unknown,
	): value is SpectraResponseData<'spectra.control.snapshot.get'> => value === null || isControlSnapshot(value),
	'spectra.control.intent.submit': isControlApplyAck,
	'spectra.control.intent.execute': isControlApplyAck,
	'spectra.control.operation.submit': isControlOperationAck,
	'spectra.control.operation.execute': isControlOperationAck,
	'spectra.control.actual.read': isControlReadResult,
	'spectra.control.page.scale.probe': (
		value: unknown,
	): value is SpectraResponseData<'spectra.control.page.scale.probe'> => {
		return isRecord(value) && typeof value.supported === 'boolean';
	},
	'spectra.content.settings.get': isContentSettings,
	'spectra.content.inject': (
		value: unknown,
	): value is SpectraResponseData<'spectra.content.inject'> => isBooleanFieldResult(
		value,
		INJECTED_RESULT_KEYS,
		'injected',
	),
	'spectra.settings.get': isSettingsSnapshot,
	'spectra.settings.patch': isSettingsSnapshot,
	'spectra.settings.ui.get': isSettingsUiSnapshot,
	'spectra.settings.ui.patch': isSettingsUiSnapshot,
	'spectra.settings.flush': (
		value: unknown,
	): value is SpectraResponseData<'spectra.settings.flush'> => isRecord(value)
		&& hasOnlyKeys(value, AUDIO_SESSION_FLUSH_RESULT_KEYS)
		&& value.flushed === true,
	'spectra.hotkeys.get': isHotkeySettings,
	'spectra.registry.get': isRegistrySnapshot,
	'spectra.registry.add': isRegistryAddResult,
	'spectra.registry.remove': isRegistryRemoveResult,
	'spectra.registry.query': isRegistryQueryResult,
	'spectra.registry.mark-probed': isRegistryAddResult,
	'spectra.media-route.rules.get': isMediaRouteRulesSnapshot,
	'spectra.media-route.rules.upsert': isMediaRouteRulesSnapshot,
	'spectra.media-route.rules.remove': isMediaRouteRulesSnapshot,
	'spectra.hotkey-target.get': isHotkeyTargetState,
	'spectra.hotkey-target.set': isHotkeyTargetState,
	'spectra.remote.session.get': isRemoteSessionStatus,
	'spectra.remote.session.create': isRemotePublicSession,
	'spectra.remote.session.close': (
		value: unknown,
	): value is SpectraResponseData<'spectra.remote.session.close'> => isRecord(value)
		&& hasOnlyKeys(value, CLOSED_RESULT_KEYS)
		&& value.closed === true,
	'spectra.user-script.execute': (
		value: unknown,
	): value is SpectraResponseData<'spectra.user-script.execute'> => isRecord(value)
		&& hasOnlyKeys(value, EXECUTED_RESULT_KEYS)
		&& value.executed === true,
	'spectra.audio.config.get': isAudioConfig,
	'spectra.audio.policy.get': isAudioSitePolicy,
	'spectra.audio.route.get': isMediaRouteDecision,
	'spectra.audio.route.record': isMediaRouteDecision,
	'spectra.audio.page-scale.record': (
		value: unknown,
	): value is SpectraResponseData<'spectra.audio.page-scale.record'> => {
		return isRecord(value) && value.recorded === true;
	},
	'spectra.audio.config.set': (
		value: unknown,
	): value is SpectraResponseData<'spectra.audio.config.set'> => isRecord(value)
		&& hasOnlyKeys(value, SAVED_RESULT_KEYS)
		&& value.saved === true,
	'spectra.audio.runtime.get': isAudioRuntimeStatus,
	'spectra.audio.runtime.configure': isAudioRuntimeStatus,
	'spectra.audio.session.get': (
		value: unknown,
	): value is SpectraResponseData<'spectra.audio.session.get'> => value === null || isAudioSessionSnapshot(value),
	'spectra.audio.session.current': (
		value: unknown,
	): value is SpectraResponseData<'spectra.audio.session.current'> => value === null || isAudioSessionSnapshot(value),
	'spectra.audio.session.publish': isAudioSessionSnapshot,
	'spectra.audio.session.flush': (
		value: unknown,
	): value is SpectraResponseData<'spectra.audio.session.flush'> => isRecord(value)
		&& hasOnlyKeys(value, AUDIO_SESSION_FLUSH_RESULT_KEYS)
		&& value.flushed === true,
	'spectra.audio.capture.set': isAudioCaptureTransitionResult,
	'spectra.audio.capture.config': isAudioCaptureState,
	'spectra.audio.visualizer.batch': isVisualizerBatchResult,
	'spectra.audio.visualizer.get': isVisualizerFrameResult,
	'spectra.audio.visualizer.demand.set': isAudioRuntimeStatus,
	'spectra.hotkey.trigger': (
		value: unknown,
	): value is SpectraResponseData<'spectra.hotkey.trigger'> => isRecord(value)
		&& hasOnlyKeys(value, HANDLED_RESULT_KEYS)
		&& value.handled === true,
	'spectra.media.state.get': isMediaStateResult,
	'spectra.media.play.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.media.play.toggle'> => isBooleanFieldResult(
		value,
		PLAYING_RESULT_KEYS,
		'playing',
	),
	'spectra.media.pip.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.media.pip.toggle'> => isBooleanFieldResult(
		value,
		ACTIVE_RESULT_KEYS,
		'active',
	),
	'spectra.media.speed.set': isMediaSpeedResult,
	'spectra.video.rotate': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.rotate'> => isRecord(value)
		&& hasOnlyKeys(value, ROTATION_RESULT_KEYS)
		&& isFiniteInRange(value.rotation, 0, 359),
	'spectra.video.mirror.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.mirror.toggle'> => isBooleanFieldResult(
		value,
		MIRRORED_RESULT_KEYS,
		'mirrored',
	),
	'spectra.video.screenshot': isScreenshotResult,
	'spectra.screenshot.capture-visible': isScreenshotResult,
	'spectra.screenshot.target.verify': (
		value: unknown,
	): value is SpectraResponseData<'spectra.screenshot.target.verify'> => isRecord(value)
		&& hasOnlyKeys(value, SCREENSHOT_TARGET_VERIFY_RESULT_KEYS)
		&& value.valid === true,
	'spectra.video.fullscreen.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.fullscreen.toggle'> => isBooleanFieldResult(
		value,
		ACTIVE_RESULT_KEYS,
		'active',
	),
	'spectra.video.crop.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.crop.toggle'> => isBooleanFieldResult(
		value,
		CROPPED_RESULT_KEYS,
		'cropped',
	),
	'spectra.video.seek': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.seek'> => isRecord(value)
		&& hasOnlyKeys(value, CURRENT_TIME_RESULT_KEYS)
		&& isFiniteInRange(value.currentTime, 0, Number.MAX_SAFE_INTEGER),
	'spectra.video.filter.set': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.filter.set'> => isBooleanFieldResult(
		value,
		APPLIED_RESULT_KEYS,
		'applied',
	),
	'spectra.video.filter.reset': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.filter.reset'> => isBooleanFieldResult(
		value,
		RESET_RESULT_KEYS,
		'reset',
	),
	'spectra.video.dim.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.dim.toggle'> => isRecord(value)
		&& hasOnlyKeys(value, DIM_RESULT_KEYS)
		&& typeof value.active === 'boolean'
		&& isFiniteInRange(value.opacity, 0, 1),
	'spectra.video.ab.a.set': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.ab.a.set'> => isRecord(value)
		&& hasOnlyKeys(value, POINT_A_RESULT_KEYS)
		&& isNullableTime(value.pointA),
	'spectra.video.ab.b.set': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.ab.b.set'> => isRecord(value)
		&& hasOnlyKeys(value, POINT_B_RESULT_KEYS)
		&& isNullableTime(value.pointB)
		&& typeof value.looping === 'boolean',
	'spectra.video.ab.clear': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.ab.clear'> => isRecord(value)
		&& hasOnlyKeys(value, CLEARED_RESULT_KEYS)
		&& value.cleared === true,
	'spectra.video.ab.get': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.ab.get'> => isRecord(value)
		&& hasOnlyKeys(value, AB_STATE_RESULT_KEYS)
		&& isNullableTime(value.pointA)
		&& isNullableTime(value.pointB)
		&& typeof value.looping === 'boolean',
	'spectra.video.marker.add': isMarkerResult,
	'spectra.video.marker.remove': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.marker.remove'> => isBooleanFieldResult(
		value,
		REMOVED_RESULT_KEYS,
		'removed',
	),
	'spectra.video.marker.jump': (
		value: unknown,
	): value is SpectraResponseData<'spectra.video.marker.jump'> => isRecord(value)
		&& hasOnlyKeys(value, JUMP_RESULT_KEYS)
		&& typeof value.jumped === 'boolean'
		&& isFiniteInRange(value.time, 0, Number.MAX_SAFE_INTEGER),
	'spectra.video.marker.list': isMarkersResult,
	'spectra.tab.media.report': (
		value: unknown,
	): value is SpectraResponseData<'spectra.tab.media.report'> => isRecord(value)
		&& hasOnlyKeys(value, REPORTED_RESULT_KEYS)
		&& value.reported === true,
	'spectra.tab.visible.list': isVisibleTabsResult,
	'spectra.tab.visible.settle': isVisibleTabsResult,
	'spectra.tab.pinned.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.tab.pinned.toggle'> => isRecord(value)
		&& hasOnlyKeys(value, PINNED_RESULT_KEYS)
		&& typeof value.pinned === 'boolean',
	'spectra.tab.muted.toggle': (
		value: unknown,
	): value is SpectraResponseData<'spectra.tab.muted.toggle'> => isRecord(value)
		&& hasOnlyKeys(value, MUTED_RESULT_KEYS)
		&& typeof value.muted === 'boolean',
	'spectra.ui.open': (
		value: unknown,
	): value is SpectraResponseData<'spectra.ui.open'> => isRecord(value)
		&& hasOnlyKeys(value, OPENED_RESULT_KEYS)
		&& value.opened === true,
} satisfies { [T in SpectraRequestType]: RuntimeGuard<SpectraResponseData<T>> };

const EVENT_PAYLOAD_GUARDS = {
	'spectra.control.snapshot.changed': isControlSnapshot,
	'spectra.content.settings.changed': isContentSettings,
	'spectra.settings.changed': isSettingsSnapshot,
	'spectra.settings.ui.changed': isSettingsUiSnapshot,
	'spectra.hotkeys.changed': isHotkeySettings,
	'spectra.hotkey.target.feedback': isHotkeyTargetFeedback,
	'spectra.navigation.changed': isNavigationChangedEvent,
	'spectra.remote.session.changed': isRemoteSessionChangedEvent,
	'spectra.remote.session.closed': isRemoteSessionClosedEvent,
	'spectra.audio.session.changed': isAudioSessionSnapshot,
	'spectra.audio.capture.changed': isAudioCaptureState,
	'spectra.audio.route.changed': isMediaRouteChangedEvent,
} satisfies { [T in SpectraEventType]: RuntimeGuard<SpectraEventPayload<T>> };

function isSpectraRequestType(value: unknown): value is SpectraRequestType {
	return typeof value === 'string' && Object.hasOwn(REQUEST_PAYLOAD_GUARDS, value);
}

function isSpectraEventType(value: unknown): value is SpectraEventType {
	return typeof value === 'string' && Object.hasOwn(EVENT_PAYLOAD_GUARDS, value);
}

export { isRpcError } from './spectra.protocol-primitives.js';

// post: rejects unknown message types and malformed payloads before a handler sees them
export function isSpectraRequestEnvelope(value: unknown): value is SpectraRequestEnvelope {
	if (!isRecord(value)
		|| !hasValidRequestEnvelopeBase(value)
		|| !isSpectraRequestType(value.type)) return false;
	const payloadGuard: RuntimeGuard<unknown> = REQUEST_PAYLOAD_GUARDS[value.type];
	if (!payloadGuard(value.payload)) return false;
	return hasCanonicalRequestContext(value.type, value);
}

// post: accepts only versioned, type-correlated events with trustworthy routing metadata
export function isSpectraEventEnvelope(value: unknown): value is SpectraEventEnvelope {
	if (!isRecord(value)
		|| !hasValidEventEnvelopeBase(value)
		|| !isSpectraEventType(value.type)) return false;
	const payloadGuard: RuntimeGuard<unknown> = EVENT_PAYLOAD_GUARDS[value.type];
	if (!payloadGuard(value.payload)) return false;
	if (value.type === 'spectra.audio.session.changed') {
		const payload = value.payload as AudioSessionSnapshot;
		return value.tabId === payload.tabId
			&& value.documentId === payload.documentId
			&& value.generation === payload.generation;
	}
	if (value.type === 'spectra.audio.capture.changed') {
		const payload = value.payload as AudioCaptureState;
		return value.tabId === payload.tabId
			&& isDocumentId(value.documentId)
			&& value.generation === payload.generation;
	}
	if (value.type === 'spectra.navigation.changed') {
		return isPositiveInteger(value.tabId)
			&& typeof value.documentId === 'string'
			&& value.documentId.length > 0
			&& value.generation === undefined;
	}
	if (value.type === 'spectra.hotkey.target.feedback') {
		return isPositiveInteger(value.tabId);
	}
	if (value.type === 'spectra.remote.session.changed' || value.type === 'spectra.remote.session.closed') {
		return isRecord(value.payload) && value.tabId === value.payload.tabId;
	}
	return true;
}

// post: validates both the RpcResult shape and request-specific response data
export function isSpectraResponse<T extends SpectraRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<T> {
	if (!isSpectraRequestType(type)) return false;
	if (isRpcSuccessResult(value)) {
		const responseGuard: RuntimeGuard<unknown> = RESPONSE_DATA_GUARDS[type];
		return responseGuard(value.data);
	}
	return isRpcFailureResult(value) && isRpcError(value.error);
}

export function rpcSuccess<T>(data: T): RpcResult<T> {
	return { ok: true, data };
}

export function rpcFailure(code: string, message: string, retryable = false): RpcResult<never> {
	return { ok: false, error: { code, message, retryable } };
}
