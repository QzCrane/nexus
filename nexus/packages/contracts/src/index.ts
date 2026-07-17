// goal: pure contract layer with zero logic for cross-package type sharing and AI context efficiency

// Common types
export type {
  Result,
  Maybe,
  TabId,
  VolumeLevel,
  DomainName,
  EventHandler,
  Unsubscribe
} from './common.types.js';

// Audio contracts
export type {
  AudioConfig,
  AudioProcessorConfig,
  ResolvedAudioVolume,
  AudioMode,
  AudioState,
  SpectraAudioMode,
  AudioSessionPhase,
  AudioSessionError,
  AudioSessionSnapshot,
  AudioRuntimeStatus,
  AudioCaptureState,
  TabSessionIdentity,
  IAudioService,
  IPolicyEngine,
  PolicyContext,
  UrlInfo,
  SiteRule
} from './audio.contracts.js';

export {
  DEFAULT_AUDIO_CONFIG,
  isAudioConfig,
  isAudioProcessorConfig,
  isAudioConfigPatch,
  isAudioSessionError,
  isAudioSessionSnapshot,
  isAudioRuntimeStatus,
  isAudioCaptureState,
  isDefaultAudioConfig,
  resolveAudioVolume
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
	ControlIntentSource,
	MediaKind,
	MediaTarget,
	VideoFilterState,
	ABLoopState,
	ControlValues,
	ControlField,
	ControlDirectField,
	SiteNativeAdapterId,
	SiteNativeControlField,
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
	ControlMainWorldPolicy,
	ControlRecurringWork,
	ControlAlgorithmPolicy,
	ControlNativePreference,
	ControlAugmentationAdmission,
	ControlAlgorithmAdjudication,
	ControlPatch,
	ControlError,
	ControlFieldState,
	ControlFieldStates,
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
	CONTROL_STRATEGY_RULES,
	CONTROL_RETRYABLE_STRATEGY_FAILURES,
	CONTROL_TERMINAL_STRATEGY_FAILURES,
	CONTROL_FIELDS,
	CONTROL_DIRECT_FIELDS,
	SITE_NATIVE_ADAPTER_DESCRIPTORS,
	CONTROL_OPERATIONS,
	CONTROL_CAPABILITIES,
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_ALGORITHM_ADJUDICATIONS,
	compileEffectiveVolume,
	splitLegacyVolume,
	classifyControlStrategy,
	isControlStrategyFailure,
	shouldTryNextControlStrategy,
	matchSiteNativeAdapter,
	isControlError,
	isMediaTarget,
	isControlPatch,
	isControlIntent,
	isControlSubmitRequest,
	isControlOperationRequest,
	isControlOperationIntent,
	isControlOperationAck,
	isControlSnapshot,
	isControlApplyAck,
	isControlReadRequest,
	isControlReadResult,
} from './control.contracts.js';

// Messaging contracts
export type {
  NexusMessages,
  NexusAction,
  NexusRequest,
  NexusResponse,
  INexusMessenger,
  INexusRouter
} from './messages.contracts.js';

// Settings contracts
export type {
  GlobalSettings,
  SupportedLanguage,
  IStorageRepository,
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
  SPECTRA_SETTINGS_SCHEMA_VERSION,
  isGlobalSettings,
	isHotkeySettings,
  isSettingsPatchRequest,
  isSettingsSnapshot
} from './settings.contracts.js';

// SPECTRA v2 protocol and runtime guards
export type {
	RpcError,
	RpcResult,
	ContentRuntimeLeaseReason,
	ContentRuntimeSourceOwnership,
	ContentRuntimeStatus,
	ContentRuntimeReadyResult,
	VisualizerBatchPayload,
	VisualizerBatchResult,
	AudioSessionPublishPayload,
	AudioConfigSavedResult,
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
	SPECTRA_PROTOCOL_VERSION,
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	isRpcError,
	isSpectraRequestEnvelope,
	isSpectraEventEnvelope,
	isSpectraResponse,
	rpcSuccess,
	rpcFailure,
} from './spectra.protocol.js';

// Canonical domain utilities
export {
	normalizeHostname,
	isIpHostname,
	hostnameMatchesRule,
	findBestHostnameMatch,
} from './domain.contracts.js';

// Registry contracts
export type {
  DomainSource,
  DomainEntry,
	RegistryStorage,
  RegistryResult,
	RegistrySnapshot,
	RegistryAddResult,
	RegistryRemoveResult,
	RegistryQueryResult,
	HotkeyTargetState
} from './registry.contracts.js';
export { isDomainEntry, isRegistryEntries } from './registry.contracts.js';

export {
	REMOTE_COMMANDS,
	REMOTE_COMMAND_DESCRIPTORS,
	isRemoteCommand,
	isRemotePublicSession,
	isRemoteSessionToken,
	isRemoteState,
} from './remote.contracts.js';
export type {
	RemoteCommand,
	RemoteCommandDescriptor,
	RemoteCommandOperation,
	RemotePublicSession,
	RemoteState,
	RemoteSessionStatus,
	RemoteSessionChangedEvent,
	RemoteSessionClosedEvent,
} from './remote.contracts.js';

// Unified background/offscreen host contracts
export type {
	OffscreenHostSnapshot,
	OffscreenAudioResult,
	OffscreenVisualizerFrame,
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
	isHotkeyParamsForAction,
	isSlotHotkeyAction,
  DEFAULT_MODIFIERS,
  DEFAULT_HOTKEY_SETTINGS,
  DEFAULT_SLOTS,
  PRESET_BINDINGS
} from './hotkeys.contracts.js';

// Message Action constants
export { Actions, NEXUS_ACTIONS } from './actions.js';
export type { NexusActionName } from './actions.js';
