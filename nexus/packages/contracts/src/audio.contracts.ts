// goal: defines core audio data structures and service interfaces for the audio engine

import {
  clampControlValue,
  compileEffectiveVolume,
  isFiniteControlValue,
  splitEffectiveVolume,
} from './control-value-limits.js';
import type { AudioProcessorConfig } from './audio-processor.contracts.js';
import { isRejection, type Rejection } from './fact.js';
import { keySetOf } from './key-set.js';

export interface AudioConfig {
  enabled: boolean;
  // Derived product projection. Every complete config must equal
  // compileEffectiveVolume(volumeBase, boost).
  volume: number;
  volumeBase: number;
  boost: number;
  muted: boolean;
  compressor: boolean;
  mono: boolean;
  bass: boolean;
  // inv: 10-band array, range -12 to +12
  eqValues: number[];
  // inv: -1 (left) to 1 (right)
  pan: number;
  // inv: 0ms to 500ms; browsers cannot render negative audio delay
  delay: number;
  // inv: 0.1 to 16.0, default 1.0
  speed: number;
  // Standard HTMLMediaElement pitch-preservation preference.
  preservePitch: boolean;
}

/**
 * The pre-v3 persisted audio shape. The effective `volume` projection was the
 * only required volume field; the pair was optional and was not required to
 * satisfy the current product invariant. This type is only for bounded
 * storage migration and must never cross a current runtime boundary.
 */
export type LegacyAudioConfig = Omit<AudioConfig, 'volumeBase' | 'boost'>
  & Partial<Pick<AudioConfig, 'volumeBase' | 'boost'>>;

export const DEFAULT_AUDIO_CONFIG: Readonly<AudioConfig> = {
  enabled: true,
  volume: 100,
  volumeBase: 100,
  boost: 1,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pan: 0,
  delay: 0,
  speed: 1.0,
  preservePitch: true,
} as const;

const AUDIO_CONFIG_KEYS = keySetOf<AudioConfig>()([
  'enabled',
  'volume',
  'volumeBase',
  'boost',
  'muted',
  'compressor',
  'mono',
  'bass',
  'eqValues',
  'pan',
  'delay',
  'speed',
  'preservePitch',
]);

const AUDIO_SESSION_KEYS = keySetOf<AudioSessionSnapshot>()([
  'tabId',
  'documentId',
  'origin',
  'generation',
  'desiredMode',
  'actualMode',
  'phase',
  'configRevision',
  'actualConfig',
  'lastError',
  'lastRejection',
]);

const AUDIO_RUNTIME_STATUS_KEYS = keySetOf<AudioRuntimeStatus>()([
  'config',
  'hasAudio',
  'isPlaying',
  'desiredMode',
  'actualMode',
  'phase',
  'generation',
  'userInteracted',
  'pausedAt',
  'lastError',
]);

const AUDIO_CAPTURE_STATE_KEYS = keySetOf<AudioCaptureState>()([
  'tabId',
  'generation',
  'phase',
  'active',
  'actualMode',
  'lastError',
  'actualConfig',
]);

const AUDIO_SESSION_MODES = new Set<SpectraAudioMode>(['bypass', 'webaudio', 'capture']);
const AUDIO_SESSION_PHASES = new Set<AudioSessionPhase>(['idle', 'starting', 'active', 'stopping', 'error']);
const AUDIO_SESSION_ERROR_KEYS = keySetOf<AudioSessionError>()(['code', 'message', 'retryable']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export interface ResolvedAudioVolume {
  volumeBase: number;
  boost: number;
  effectiveVolume: number;
}

export function resolveAudioVolume(config: Pick<AudioConfig, 'volumeBase' | 'boost'>): ResolvedAudioVolume {
  const volumeBase = clampControlValue(config.volumeBase, 'nativeVolume', 100);
  const boost = clampControlValue(config.boost, 'boost', 1);
  return {
    volumeBase,
    boost,
    effectiveVolume: compileEffectiveVolume(volumeBase, boost),
  };
}

/**
 * Projects the complete, validated product configuration onto the physical
 * WebAudio/Capture processor boundary. Native media fields are deliberately omitted;
 * `boostGain` is the only volume-related value owned by the graph.
 */
export function audioConfigToProcessorConfig(config: AudioConfig): AudioProcessorConfig {
  return {
    boostGain: config.boost,
    compressor: config.compressor,
    mono: config.mono,
    bass: config.bass,
    eqValues: [...config.eqValues],
    pan: config.pan,
    delay: config.delay,
  };
}

/**
 * Canonical processor predicate shared by policy, control and release gates.
 * Native media-element controls are deliberately absent: only fields that
 * require an acknowledged processor graph return true. Policy separately
 * chooses the lower-cost page MediaElement graph when every source is proven
 * safe, otherwise the explicitly admitted full-tab Capture graph.
 */
export function requiresAudioProcessor(config: Pick<
	AudioConfig,
	'volume' | 'volumeBase' | 'boost' | 'eqValues' | 'compressor' | 'bass' | 'mono' | 'pan' | 'delay'
>): boolean {
	return resolveAudioVolume(config).boost > 1
		|| config.eqValues.some((value) => value !== 0)
		|| config.compressor
		|| config.bass
		|| config.mono
		|| config.pan !== 0
		|| config.delay !== 0;
}

export interface AudioProcessorDemand {
	// A visible analyser can use a proven-safe page graph. Observation alone
	// never starts or retains full-tab Capture.
	visualizer: boolean;
	// True only when the current document can bind every media source to the
	// page-lifetime MediaElementAudioSource graph without risking CORS silence.
	mediaWebAudio: boolean;
	// A user-pinned route overrides automatic owner selection. `direct` keeps
	// processing in the page and never escalates to full-tab Capture; `capture`
	// skips a known-bad page graph after an explicit Capture admission.
	mediaRoute?: 'auto' | 'direct' | 'capture';
}

const NO_AUDIO_PROCESSOR_DEMAND: Readonly<AudioProcessorDemand> = Object.freeze({
	visualizer: false,
	mediaWebAudio: false,
});

export function resolveDesiredAudioMode(
	config: AudioConfig,
	demand: Readonly<AudioProcessorDemand> = NO_AUDIO_PROCESSOR_DEMAND,
): SpectraAudioMode {
	if (!config.enabled) return 'bypass';
	if (!requiresAudioProcessor(config)) {
		return demand.visualizer && demand.mediaWebAudio && demand.mediaRoute !== 'capture'
			? 'webaudio' : 'bypass';
	}
	if (demand.mediaRoute === 'capture') return 'capture';
	if (demand.mediaRoute === 'direct') return 'webaudio';
	return demand.mediaWebAudio ? 'webaudio' : 'capture';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isAudioSessionError(value: unknown): value is AudioSessionError {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_SESSION_ERROR_KEYS)) return false;
  return typeof value.code === 'string'
    && value.code.length > 0
    && value.code.length <= 128
    && typeof value.message === 'string'
    && value.message.length > 0
    && value.message.length <= 4096
    && typeof value.retryable === 'boolean';
}

function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin !== 'null' && url.origin === value;
  } catch {
    return false;
  }
}

// post: accepts only a complete, finite AudioConfig that the Capture runtime can implement
export function isAudioConfig(value: unknown): value is AudioConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CONFIG_KEYS)) return false;
  return typeof value.enabled === 'boolean'
    && isFiniteControlValue(value.volume, 'volume')
    && isFiniteControlValue(value.volumeBase, 'volumeBase')
    && isFiniteControlValue(value.boost, 'boost')
    && value.volume === compileEffectiveVolume(value.volumeBase, value.boost)
    && typeof value.muted === 'boolean'
    && typeof value.compressor === 'boolean'
    && typeof value.mono === 'boolean'
    && typeof value.bass === 'boolean'
    && Array.isArray(value.eqValues)
    && value.eqValues.length === 10
    && value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))
    && isFiniteControlValue(value.pan, 'pan')
    && isFiniteControlValue(value.delay, 'delay')
    && isFiniteControlValue(value.speed, 'speed')
    && typeof value.preservePitch === 'boolean';
}

/**
 * Pre-v3 storage guard. It deliberately does not call `isAudioConfig` and does
 * not enforce the derived-volume invariant, so a legacy record can be
 * canonicalized before the strict v3 guard is applied.
 */
export function isLegacyAudioConfig(value: unknown): value is LegacyAudioConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CONFIG_KEYS)) return false;
  return typeof value.enabled === 'boolean'
    && isFiniteControlValue(value.volume, 'volume')
    && (value.volumeBase === undefined || isFiniteControlValue(value.volumeBase, 'volumeBase'))
    && (value.boost === undefined || isFiniteControlValue(value.boost, 'boost'))
    && typeof value.muted === 'boolean'
    && typeof value.compressor === 'boolean'
    && typeof value.mono === 'boolean'
    && typeof value.bass === 'boolean'
    && Array.isArray(value.eqValues)
    && value.eqValues.length === 10
    && value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))
    && isFiniteControlValue(value.pan, 'pan')
    && isFiniteControlValue(value.delay, 'delay')
    && isFiniteControlValue(value.speed, 'speed')
    && typeof value.preservePitch === 'boolean';
}

/**
 * Converts a validated pre-v3 record into the strict current AudioConfig.
 * A complete legacy pair remains authoritative for compatibility with the
 * old writer; otherwise the old effective volume is split into the canonical
 * native base and Capture boost before strict validation.
 */
export function normalizeLegacyAudioConfig(value: LegacyAudioConfig): AudioConfig | null {
	if (!isLegacyAudioConfig(value)) return null;
	const volume = value.volumeBase !== undefined && value.boost !== undefined
    ? resolveAudioVolume({ volumeBase: value.volumeBase, boost: value.boost })
    : (() => {
      const split = splitEffectiveVolume(value.volume);
      return {
        volumeBase: split.volumeBase,
        boost: split.boost,
        effectiveVolume: compileEffectiveVolume(split.volumeBase, split.boost),
      };
    })();
  const normalized: AudioConfig = {
    ...DEFAULT_AUDIO_CONFIG,
    ...value,
    volume: volume.effectiveVolume,
    volumeBase: volume.volumeBase,
    boost: volume.boost,
    eqValues: [...value.eqValues],
  };
  return isAudioConfig(normalized) ? normalized : null;
}

// post: validates a field-level audio update without requiring unrelated fields
export function isAudioConfigPatch(value: unknown): value is Partial<AudioConfig> {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CONFIG_KEYS)) return false;
  const hasVolume = value.volume !== undefined;
  const hasVolumeBase = value.volumeBase !== undefined;
  const hasBoost = value.boost !== undefined;
  const consistentProjection = !hasVolume || (!hasVolumeBase && !hasBoost) || (
    hasVolumeBase
    && hasBoost
    && isFiniteControlValue(value.volume, 'volume')
    && isFiniteControlValue(value.volumeBase, 'volumeBase')
    && isFiniteControlValue(value.boost, 'boost')
    && value.volume === compileEffectiveVolume(value.volumeBase, value.boost)
  );
  return consistentProjection
    && (value.enabled === undefined || typeof value.enabled === 'boolean')
    && (value.volume === undefined || isFiniteControlValue(value.volume, 'volume'))
    && (value.volumeBase === undefined || isFiniteControlValue(value.volumeBase, 'volumeBase'))
    && (value.boost === undefined || isFiniteControlValue(value.boost, 'boost'))
    && (value.muted === undefined || typeof value.muted === 'boolean')
    && (value.compressor === undefined || typeof value.compressor === 'boolean')
    && (value.mono === undefined || typeof value.mono === 'boolean')
    && (value.bass === undefined || typeof value.bass === 'boolean')
    && (value.eqValues === undefined || (
      Array.isArray(value.eqValues)
      && value.eqValues.length === 10
      && value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))
    ))
    && (value.pan === undefined || isFiniteControlValue(value.pan, 'pan'))
    && (value.delay === undefined || isFiniteControlValue(value.delay, 'delay'))
    && (value.speed === undefined || isFiniteControlValue(value.speed, 'speed'))
    && (value.preservePitch === undefined || typeof value.preservePitch === 'boolean');
}

// post: identifies the transparent, never-activated site configuration
export function isDefaultAudioConfig(config: AudioConfig): boolean {
	const volume = resolveAudioVolume(config);
	return config.enabled === DEFAULT_AUDIO_CONFIG.enabled
		&& volume.volumeBase === DEFAULT_AUDIO_CONFIG.volumeBase
		&& volume.boost === DEFAULT_AUDIO_CONFIG.boost
		&& config.muted === DEFAULT_AUDIO_CONFIG.muted
		&& config.compressor === DEFAULT_AUDIO_CONFIG.compressor
		&& config.mono === DEFAULT_AUDIO_CONFIG.mono
		&& config.bass === DEFAULT_AUDIO_CONFIG.bass
		&& config.pan === DEFAULT_AUDIO_CONFIG.pan
		&& config.delay === DEFAULT_AUDIO_CONFIG.delay
		&& config.speed === DEFAULT_AUDIO_CONFIG.speed
		&& config.preservePitch === DEFAULT_AUDIO_CONFIG.preservePitch
		&& config.eqValues.length === DEFAULT_AUDIO_CONFIG.eqValues.length
		&& config.eqValues.every((value, index) => value === DEFAULT_AUDIO_CONFIG.eqValues[index]);
}

export type SpectraAudioMode = 'bypass' | 'webaudio' | 'capture';
export type AudioSessionPhase = 'idle' | 'starting' | 'active' | 'stopping' | 'error';
export type AudioVolumeState = 'silent' | 'native' | 'capture';

export interface AudioSessionError {
	code: string;
	message: string;
	retryable: boolean;
}

export interface TabSessionIdentity {
	tabId: number;
	documentId: string;
	origin: string;
}

// goal: acknowledged, read-only state shared by UI, badge, offscreen, and remote control
export interface AudioSessionSnapshot extends TabSessionIdentity {
	generation: number;
	desiredMode: SpectraAudioMode;
	actualMode: SpectraAudioMode;
	phase: AudioSessionPhase;
	configRevision: number;
	actualConfig: AudioConfig;
	lastError: AudioSessionError | null;
	/**
	 * Why the most recent write was refused, or what the evidence guard had to
	 * correct before admitting it. Carried on the snapshot because a refusal that
	 * never leaves the store cannot be acted on by anything (INV-1/INV-2).
	 */
	lastRejection?: Rejection | null;
}

export type AudioSessionIdentity = TabSessionIdentity & { generation: number };

// post: true only when lifecycle and field-level actual state belong to the
// same top-level document generation. UI surfaces must fail closed on a
// missing or stale session instead of carrying Capture color across navigation.
export function audioSessionMatchesIdentity<T extends AudioSessionIdentity>(
	session: T | null | undefined,
	identity: AudioSessionIdentity | null | undefined,
): session is T {
	return session !== null
		&& session !== undefined
		&& identity !== null
		&& identity !== undefined
		&& session.tabId === identity.tabId
		&& session.documentId === identity.documentId
		&& session.origin === identity.origin
		&& session.generation === identity.generation;
}

// ControlSnapshot generation orders per-field document control, while an audio
// session generation orders processor transitions. They share document
// identity but intentionally keep independent monotonic clocks.
export function audioSessionMatchesControlDocument<T extends TabSessionIdentity>(
	session: T | null | undefined,
	control: TabSessionIdentity | null | undefined,
): session is T {
	return session !== null
		&& session !== undefined
		&& control !== null
		&& control !== undefined
		&& session.tabId === control.tabId
		&& session.documentId === control.documentId
		&& session.origin === control.origin;
}

export function isActiveCaptureLifecycle(value: {
	actualMode: SpectraAudioMode | null | undefined;
	phase: AudioSessionPhase;
}): boolean {
	return value.actualMode === 'capture' && value.phase === 'active';
}

// post: the single semantic state behind Popup, badge and authenticated remote
// colors. Volume thresholds never imply Capture; only an acknowledged active
// Capture lifecycle can do so.
export function resolveAudioVolumeState(value: {
	volume: number;
	muted: boolean;
	actualMode: SpectraAudioMode | null | undefined;
	phase: AudioSessionPhase;
}): AudioVolumeState {
	if (value.muted || value.volume <= 0) return 'silent';
	return isActiveCaptureLifecycle(value)
		? 'capture'
		: 'native';
}

// goal: complete, side-effect-free status returned by the current document runtime
export interface AudioRuntimeStatus {
  config: AudioConfig;
  hasAudio: boolean;
  isPlaying: boolean;
  desiredMode: SpectraAudioMode;
  actualMode: SpectraAudioMode;
  phase: AudioSessionPhase;
  generation: number;
  userInteracted: boolean;
  pausedAt: number | null;
  lastError: AudioSessionError | null;
}

// goal: acknowledged capture processor state shared by background, content, and popup
export interface AudioCaptureState {
  tabId: number;
  generation: number;
  phase: AudioSessionPhase;
  active: boolean;
  actualMode: 'bypass' | 'capture';
  lastError: AudioSessionError | null;
  actualConfig?: AudioConfig;
}

// post: validates the complete acknowledged state before UI, badge, or remote code consumes it
export function isAudioSessionSnapshot(value: unknown): value is AudioSessionSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_SESSION_KEYS)) return false;
  return Number.isInteger(value.tabId)
    && Number(value.tabId) > 0
    && typeof value.documentId === 'string'
    && value.documentId.length > 0
    && value.documentId.length <= 256
    && isCanonicalOrigin(value.origin)
    && isNonNegativeInteger(value.generation)
    && typeof value.desiredMode === 'string'
    && AUDIO_SESSION_MODES.has(value.desiredMode as SpectraAudioMode)
    && typeof value.actualMode === 'string'
    && AUDIO_SESSION_MODES.has(value.actualMode as SpectraAudioMode)
    && typeof value.phase === 'string'
    && AUDIO_SESSION_PHASES.has(value.phase as AudioSessionPhase)
    && isNonNegativeInteger(value.configRevision)
    && isAudioConfig(value.actualConfig)
    && (value.lastError === null || isAudioSessionError(value.lastError))
    // Optional and nullable: a snapshot recorded before this field existed, and
    // one whose last write was admitted cleanly, both legitimately omit it.
    && (value.lastRejection === undefined
      || value.lastRejection === null
      || isRejection(value.lastRejection));
}

export function isAudioRuntimeStatus(value: unknown): value is AudioRuntimeStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_RUNTIME_STATUS_KEYS)) return false;
  return isAudioConfig(value.config)
    && typeof value.hasAudio === 'boolean'
    && typeof value.isPlaying === 'boolean'
    && typeof value.desiredMode === 'string'
    && AUDIO_SESSION_MODES.has(value.desiredMode as SpectraAudioMode)
    && typeof value.actualMode === 'string'
    && AUDIO_SESSION_MODES.has(value.actualMode as SpectraAudioMode)
    && typeof value.phase === 'string'
    && AUDIO_SESSION_PHASES.has(value.phase as AudioSessionPhase)
    && isNonNegativeInteger(value.generation)
    && typeof value.userInteracted === 'boolean'
    && (value.pausedAt === null || isNonNegativeInteger(value.pausedAt))
    && (value.lastError === null || isAudioSessionError(value.lastError));
}

export function isAudioCaptureState(value: unknown): value is AudioCaptureState {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CAPTURE_STATE_KEYS)) return false;
  return Number.isInteger(value.tabId)
    && Number(value.tabId) > 0
    && isNonNegativeInteger(value.generation)
    && typeof value.phase === 'string'
    && AUDIO_SESSION_PHASES.has(value.phase as AudioSessionPhase)
    && typeof value.active === 'boolean'
    && (value.actualMode === 'bypass' || value.actualMode === 'capture')
    && value.actualMode === (value.active ? 'capture' : 'bypass')
    && (value.actualConfig === undefined || isAudioConfig(value.actualConfig))
    && (value.lastError === null || isAudioSessionError(value.lastError));
}
