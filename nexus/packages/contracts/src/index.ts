// goal: pure contract layer with zero logic for cross-package type sharing and AI context efficiency

// Common types
export type {
  Result,
  Maybe,
  EventHandler,
  Unsubscribe
} from './common.types.js';

export type {
	ControlValueLimit,
	ControlValueLimitName,
} from './control-value-limits.js';
export {
	createSiteRouteFingerprint,
	createMediaRouteRuleFingerprint,
	createMediaRouteScopeKey,
	isDomainEntry,
	isMediaProcessingRoute,
	isMediaRouteFingerprint,
	isMediaRouteEntry,
	isMediaRouteChangedEvent,
	isMediaRouteDecision,
	isMediaRouteRecordRequest,
	isMediaRouteSettings,
	isMediaRouteRuleEntry,
	isMediaRouteRulesSnapshot,
	isMediaRouteRuleUpsertPayload,
	isRegistryEntries,
	isRegistryAddResult,
	isRegistryAddPayload,
	isRegistryQueryResult,
	isRegistryQueryPayload,
	isRegistryRemoveResult,
	isRegistryRemovePayload,
	isRegistryRecordPayload,
	isRegistrySnapshot,
	selectMediaProcessingRoute,
	selectMediaRouteDecisionForUrl,
	normalizeMediaRouteScope,
	parseMediaRouteScopeInput,
	parseMediaRouteScopeKey,
} from './media-route.contracts.js';
export type {
	DomainEntry,
	DomainSource,
	MediaRoute,
	MediaProcessingRoute,
	MediaRouteEntry,
	MediaRouteRuleEntry,
	MediaRouteRulesSnapshot,
	MediaRouteRuleUpsertPayload,
	MediaRouteScope,
	MediaRouteChangedEvent,
	MediaRouteDecision,
	MediaRouteRecordRequest,
	MediaRouteSettings,
	MediaRouteSource,
	RegistryAddResult,
	RegistryAddPayload,
	RegistryQueryResult,
	RegistryQueryPayload,
	RegistryRemoveResult,
	RegistryRemovePayload,
	RegistryRecordPayload,
	RegistrySnapshot,
} from './media-route.contracts.js';

export {
	CONTROL_VALUE_LIMITS,
	clampControlValue,
	isFiniteControlValue,
} from './control-value-limits.js';

export {
	crossesVolumeRoute,
	resolveBoostRoute,
	resolveNativeRoute,
	resolveVolumeTone,
	shouldHoldVolumeTone,
} from './volume-presentation.contracts.js';

export type {
	VolumeBoostRoute,
	VolumeNativeRoute,
	VolumeTone,
	VolumeToneInput,
} from './volume-presentation.contracts.js';
export type { VolumeRouteHoldInput } from './volume-presentation.contracts.js';

export type {
	CaptureAdmission,
	CaptureAdmissionKind,
	CaptureDocumentKey,
} from './capture-admission.contracts.js';
export {
	CAPTURE_ADMISSION_KINDS,
	isCaptureAdmission,
	isCaptureDocumentKey,
} from './capture-admission.contracts.js';

// Audio contracts
export type { AudioProcessorConfig } from './audio-processor.contracts.js';
export { isAudioProcessorConfig } from './audio-processor.contracts.js';
export type { BoundedMap, BoundedOptions, BoundedRegistry, BoundedSet } from './bounded.js';
export type { ProcessorAck, StartIntent } from './offscreen.contracts.js';
export { isProcessorAck, mintStartIntent, verifyProcessorAck } from './offscreen.contracts.js';
export { createBoundedMap, createBoundedSet } from './bounded.js';
export type { Rejection, Verdict } from './fact.js';
export { accept, describeRejection, isRejection, isRetryableRejection, reject } from './fact.js';

export type {
  AudioConfig,
  LegacyAudioConfig,
  AudioProcessorDemand,
  ResolvedAudioVolume,
  SpectraAudioMode,
  AudioSessionPhase,
  AudioVolumeState,
  AudioSessionError,
  AudioSessionSnapshot,
  AudioSessionIdentity,
  AudioRuntimeStatus,
  AudioCaptureState,
  TabSessionIdentity
} from './audio.contracts.js';

export {
  DEFAULT_AUDIO_CONFIG,
  isAudioConfig,
  isLegacyAudioConfig,
  normalizeLegacyAudioConfig,
  isAudioConfigPatch,
  isAudioSessionError,
  isAudioSessionSnapshot,
  isAudioRuntimeStatus,
  isAudioCaptureState,
  isDefaultAudioConfig,
  resolveAudioVolume,
  audioConfigToProcessorConfig,
  requiresAudioProcessor,
  resolveDesiredAudioMode,
  audioSessionMatchesIdentity,
  audioSessionMatchesControlDocument,
  isActiveCaptureLifecycle,
  resolveAudioVolumeState,
} from './audio.contracts.js';

// Per-field SPECTRA control contracts
export type {
	ControlStrategy,
	ControlStrategyClass,
	ControlInterceptionKind,
	ControlAdmissionEvidence,
	ControlWriterOwner,
	ControlAudioRuntimeCost,
	ControlStrategyRule,
	ControlRetryableStrategyFailure,
	ControlTerminalStrategyFailure,
	ControlStrategyFailure,
	ControlCoverage,
	ControlRequestedCoverage,
	ControlFieldPhase,
	ControlWriteState,
	ControlIntentSource,
	MediaKind,
	MediaTarget,
	VideoFilterState,
	ABLoopState,
	ControlValues,
	ControlField,
	ControlDirectField,
	ControlObservationStrategy,
	ControlObservationStrategies,
	ControlOperation,
	ControlMarker,
	ControlScreenshotResult,
	ControlFrameStepResult,
	ControlOperationPayloadMap,
	ControlOperationResultMap,
	ControlOperationPayload,
	ControlOperationResult,
	ControlOperationRequest,
	ControlOperationIntent,
	ControlOperationAck,
	ControlCapability,
	ControlScope,
	ControlAlgorithmKind,
	ControlAcknowledgement,
	ControlActualContext,
	ControlRecurringWork,
	ControlAlgorithmPolicy,
	ControlNativePreference,
	ControlAugmentationAdmission,
	ControlAlgorithmAdjudication,
	ControlPatch,
	ControlSessionField,
	ControlSessionPatch,
	ControlError,
	ControlFieldState,
	ControlFieldStates,
	ControlAudioVolumeProjection,
	ControlIntent,
	ControlSubmitRequest,
	ControlMutationOperation,
	ControlMutation,
	ControlSnapshot,
	ControlApplyAck,
	ControlReadRequest,
	ControlReadResult,
} from './control.contracts.js';
export {
	CONTROL_STRATEGIES,
	CONTROL_OBSERVATION_STRATEGIES,
	CONTROL_STRATEGY_RULES,
	CONTROL_RETRYABLE_STRATEGY_FAILURES,
	CONTROL_TERMINAL_STRATEGY_FAILURES,
	CONTROL_FIELDS,
	CONTROL_DIRECT_FIELDS,
	CONTROL_SESSION_FIELDS,
	CONTROL_BOOTSTRAP_OBSERVATION_GROUPS,
	CONTROL_OPERATIONS,
	CONTROL_CAPABILITIES,
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_ALGORITHM_ADJUDICATIONS,
	controlCapabilityUsesAcknowledgement,
	controlCapabilityUsesStrategy,
	selectControlAlgorithmAdjudication,
	selectControlAlgorithmPolicy,
	selectControlCapabilityScope,
	selectControlStrategyClass,
	selectControlStrategyRule,
	compileEffectiveVolume,
	splitEffectiveVolume,
	resolveAcknowledgedProcessorLifecycle,
	resolveAcknowledgedAudioVolumeState,
	resolveControlAudioVolume,
	classifyControlStrategy,
	isControlObservationStrategy,
	isControlStrategyAdmittedForCapability,
	isControlStrategyFailure,
	shouldTryNextControlStrategy,
	isControlWriteDrift,
	isControlWriteSettled,
	isControlError,
	isMediaTarget,
	isControlPatch,
	isControlSessionPatch,
	hasExtensionOnlyContribution,
	isControlIntent,
	isControlSubmitRequest,
	isControlOperationRequest,
	isControlOperationIntent,
	isControlOperationAck,
	isControlSnapshot,
	isControlApplyAck,
	explainControlApplyAck,
	isControlReadRequest,
	isControlReadResult,
} from './control.contracts.js';


// Settings contracts
export type {
	GlobalSettings,
	AudioSitePolicy,
  SupportedLanguage,
  ThemeMode,
  SettingsSnapshot,
  AudioPresetMeta,
  AudioPresetValue,
  HotkeySiteMutation,
  SettingsPatch,
  SettingsPatchRequest
} from './settings.contracts.js';

export {
  DEFAULT_GLOBAL_SETTINGS,
  MAX_SETTINGS_SNAPSHOT_ENTRIES,
  SPECTRA_SETTINGS_SCHEMA_VERSION,
  isGlobalSettings,
	isHotkeySettings,
	isAudioSitePolicy,
  isSettingsPatchRequest,
  isSettingsSnapshot
} from './settings.contracts.js';
export type {
	SettingsUiPatch,
	SettingsUiPatchRequest,
	SettingsUiSnapshot,
} from './settings-ui.contracts.js';
export {
	isSettingsUiPatch,
	isSettingsUiPatchRequest,
	isSettingsUiSnapshot,
	toSettingsUiSnapshot,
} from './settings-ui.contracts.js';

// SPECTRA v2 protocol and runtime guards
export type {
	RpcError,
	RpcResult,
	ContentRuntimeLeaseReason,
	ContentRuntimeSourceOwnership,
	ContentRuntimeStatus,
	ContentRuntimeReadyResult,
	AudioSessionPublishPayload,
	AudioConfigSavedResult,
	AudioCaptureTransitionPayload,
	AudioCaptureTransitionResult,
	TabPinnedResult,
	TabMutedResult,
	UiOpenedResult,
	SpectraContentSettings,
	MediaStateResult,
	TimeMarkerResult,
	VideoFilterPayload,
	ScreenshotCapturePayload,
	ScreenshotResult,
	SpectraRequestMap,
	SpectraEventMap,
	SpectraRequestType,
	SpectraEventType,
	SpectraRequestPayload,
	SpectraEventPayload,
	SpectraResponseData,
	SpectraResponse,
	SpectraExchange,
	SpectraRequestEnvelope,
	SpectraEventEnvelope,
} from './spectra.protocol.js';
export {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	isSpectraRequestEnvelope,
	isSpectraEventEnvelope,
	isSpectraResponse,
	rpcSuccess,
	rpcFailure,
} from './spectra.protocol.js';
export { createSpectraEvent, createSpectraRequest } from './spectra.wire.js';
export type { SpectraWireContext } from './spectra.wire.js';
export {
	SPECTRA_PROTOCOL_VERSION,
	hasOnlyProtocolKeys,
	hasValidContextFields,
	hasValidEventEnvelopeBase,
	hasValidRequestEnvelopeBase,
	isDocumentId,
	isEmptyPayload,
	isFiniteInRange,
	isFiniteNumber,
	isNonNegativeInteger,
	isPositiveInteger,
	isProtocolRecord,
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
	isRuntimeRevision,
} from './spectra.protocol-primitives.js';
export {
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
	isRemoteSessionClosePayload,
	isRemoteSessionPayload,
	isScreenshotCapturePayload,
	isTabIdPayload,
	isTabMediaReportPayload,
	isUiOpenPayload,
	isUserScriptPayload,
} from './spectra.background-runtime.js';
export type {
	AudioVisualizerDemandPayload,
	VisualizerBatchPayload,
	VisualizerBatchResult,
	VisualizerFrameResult,
} from './visualizer.contracts.js';
export {
	isAudioVisualizerDemandPayload,
	isVisualizerBatchPayload,
	isVisualizerBatchResult,
	isVisualizerFrameResult,
} from './visualizer.contracts.js';
export {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	createSpectraLeanSiteHotkeyConfiguration,
	SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE,
	SPECTRA_DEFAULT_HOTKEY_ACTIONS,
	SPECTRA_REPEATABLE_DEFAULT_HOTKEY_ACTIONS,
	isSpectraDefaultHotkeyTriggerPayload,
	isSpectraRepeatableDefaultHotkeyAction,
	isSpectraLeanSiteHotkeyConfiguration,
	isSpectraLeanSiteHotkeyConfigureMessage,
	resolveSpectraDefaultHotkeyAction,
} from './spectra.bootstrap.js';
export type {
	SpectraDefaultHotkeyAction,
	SpectraDefaultHotkeyChord,
	SpectraDefaultHotkeyPhase,
	SpectraDefaultHotkeyTriggerPayload,
	SpectraLeanSiteHotkeyBinding,
	SpectraLeanSiteHotkeyConfiguration,
	SpectraLeanSiteHotkeyConfigureMessage,
} from './spectra.bootstrap.js';

// Canonical domain utilities
export {
	normalizeHostname,
	isIpHostname,
	hostnameMatchesRule,
	findBestHostnameMatch,
} from './domain.contracts.js';

export {
	isHotkeyTargetState,
} from './hotkey-target.contracts.js';
export type { HotkeyTargetState } from './hotkey-target.contracts.js';

export {
	REMOTE_COMMAND_RECEIPT_LIMIT,
	REMOTE_COMMAND_PENDING_LIMIT,
	REMOTE_COMMAND_TIMEOUT_MS,
	REMOTE_PENDING_CONNECTION_LIMIT,
	REMOTE_PAIRING_LIMIT,
	REMOTE_PAIRING_STORAGE_LIMIT_BYTES,
	REMOTE_COMMANDS,
	REMOTE_COMMAND_DESCRIPTORS,
	REMOTE_PROTOCOL_VERSION,
	isRemoteCommand,
	isRemoteCommandId,
	isRemotePeerId,
	isRemotePublicSession,
	isRemoteSessionView,
	toRemotePublicSession,
	toRemoteSessionView,
	REMOTE_PUBLIC_SESSION_KEYS,
	REMOTE_SESSION_VIEW_KEYS,
	isRemoteSessionEpoch,
	isRemoteSessionToken,
	isRemoteState,
} from './remote.contracts.js';
export type {
	RemoteCommand,
	RemoteCommandDescriptor,
	RemoteCommandOperation,
	RemotePublicSession,
	RemoteSessionView,
	RemoteState,
	RemoteSessionStatus,
	RemoteSessionChangedEvent,
	RemoteSessionClosedEvent,
} from './remote.contracts.js';

// Unified background/offscreen host contracts
export type {
	OffscreenHostSnapshot,
	OffscreenAudioResult,
	OffscreenVisualizerBatch,
	RemoteHostSession,
	RemoteHostCreateResponse,
	RemoteHostStatusResponse,
	RemoteHostDescribeResponse,
	RemoteHostMutationResponse,
	OffscreenHostRequestMap,
	OffscreenHostRequestType,
	OffscreenHostRequest,
	OffscreenHostWireRequest,
	OffscreenHostResponse,
	OffscreenAudioRequestType,
	OffscreenAudioRequest,
	RemoteHostRequestType,
	RemoteHostRequest,
	RemoteHostCloseReason,
	OffscreenHostEventType,
	OffscreenHostEvent,
	OffscreenAudioEvent,
	RemoteHostEventType,
	RemoteHostEvent,
} from './offscreen.contracts.js';
export {
	isOffscreenHostRequest,
	isOffscreenHostResponse,
	isOffscreenHostEvent,
	isOffscreenHostSnapshot,
	isOffscreenAudioResult,
	isRemoteHostSession,
} from './offscreen.contracts.js';

// Hotkey contracts
export type {
  HotkeyAction,
	HotkeyAvailability,
	HotkeyFeedbackOwner,
	HotkeyRepeatPolicy,
	HotkeyParameterKind,
	HotkeyActionDescriptor,
	SpectraHotkeyActualFeedback,
  KeyModifiers,
  KeyCombo,
  HotkeyBinding,
  HotkeyParams,
  HotkeyConditions,
  HotkeySettings,
  SlotMapping,
  SiteHotkeyConfig
} from './hotkeys.contracts.js';

export {
  HOTKEY_ACTIONS,
	HOTKEY_ACTION_DESCRIPTORS,
	hotkeyActionRequiresUserActivation,
	isHotkeyAction,
	isHotkeyParamsForAction,
	isSpectraDefaultHotkeyKeyCombo,
	isSlotHotkeyAction,
	resolveSpectraHotkeyActualFeedback,
	selectHotkeyActionDescriptor,
	selectHotkeyAvailability,
	selectHotkeyCapability,
	selectHotkeyFeedbackOwner,
	selectHotkeyParameterKind,
	selectHotkeyRepeatPolicy,
	DEFAULT_MODIFIERS,
  DEFAULT_HOTKEY_SETTINGS
} from './hotkeys.contracts.js';

// Message Action constants
export { Actions, NEXUS_ACTIONS } from './actions.js';
export type {
	NexusAction,
	NexusActionName,
	NexusMessages,
	NexusRequest,
	NexusResponse,
} from './actions.js';
