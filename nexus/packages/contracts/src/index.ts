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
  isAudioConfigPatch,
  isAudioSessionError,
  isAudioSessionSnapshot,
  isAudioRuntimeStatus,
  isAudioCaptureState,
  isDefaultAudioConfig
} from './audio.contracts.js';

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
  isSettingsPatchRequest,
  isSettingsSnapshot
} from './settings.contracts.js';

// SPECTRA v2 protocol and runtime guards
export type {
	RpcError,
	RpcResult,
	AudioSessionPublishPayload,
	AudioConfigSavedResult,
	TabPinnedResult,
	TabMutedResult,
	UiOpenedResult,
	SpectraContentSettings,
	MediaStateResult,
	TimeMarkerResult,
	VideoFilterPayload,
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
	isRemoteCommand,
	isRemotePublicSession,
	isRemoteSessionToken,
	isRemoteState,
} from './remote.contracts.js';
export type {
	RemoteCommand,
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
  DEFAULT_MODIFIERS,
  DEFAULT_HOTKEY_SETTINGS,
  DEFAULT_SLOTS,
  PRESET_BINDINGS
} from './hotkeys.contracts.js';

// Message Action constants
export { Actions, NEXUS_ACTIONS } from './actions.js';
export type { NexusActionName } from './actions.js';
