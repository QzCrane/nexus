// goal: defines core audio data structures and service interfaces for the audio engine

import type { Result } from './common.types.js';

// inv: 0-800 range where 100 is unity gain
export interface AudioConfig {
  enabled: boolean;
  volume: number;
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
}

export const DEFAULT_AUDIO_CONFIG: Readonly<AudioConfig> = {
  enabled: true,
  volume: 100,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pan: 0,
  delay: 0,
  speed: 1.0
} as const;

const AUDIO_CONFIG_KEYS = new Set<keyof AudioConfig>([
  'enabled',
  'volume',
  'muted',
  'compressor',
  'mono',
  'bass',
  'eqValues',
  'pan',
  'delay',
  'speed',
]);

const AUDIO_SESSION_KEYS = new Set<keyof AudioSessionSnapshot>([
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
]);

const AUDIO_RUNTIME_STATUS_KEYS = new Set<keyof AudioRuntimeStatus>([
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

const AUDIO_CAPTURE_STATE_KEYS = new Set<keyof AudioCaptureState>([
  'tabId',
  'generation',
  'phase',
  'active',
  'actualMode',
  'lastError',
]);

const AUDIO_SESSION_MODES = new Set<SpectraAudioMode>(['bypass', 'webaudio', 'capture']);
const AUDIO_SESSION_PHASES = new Set<AudioSessionPhase>(['idle', 'starting', 'active', 'stopping', 'error']);
const AUDIO_SESSION_ERROR_KEYS = new Set<keyof AudioSessionError>(['code', 'message', 'retryable']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
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

// post: accepts only a complete, finite AudioConfig that the WebAudio runtime can implement
export function isAudioConfig(value: unknown): value is AudioConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CONFIG_KEYS)) return false;
  return typeof value.enabled === 'boolean'
    && isFiniteInRange(value.volume, 0, 800)
    && typeof value.muted === 'boolean'
    && typeof value.compressor === 'boolean'
    && typeof value.mono === 'boolean'
    && typeof value.bass === 'boolean'
    && Array.isArray(value.eqValues)
    && value.eqValues.length === 10
    && value.eqValues.every((item) => isFiniteInRange(item, -12, 12))
    && isFiniteInRange(value.pan, -1, 1)
    && isFiniteInRange(value.delay, 0, 500)
    && isFiniteInRange(value.speed, 0.1, 16);
}

// post: validates a field-level audio update without requiring unrelated fields
export function isAudioConfigPatch(value: unknown): value is Partial<AudioConfig> {
  if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_CONFIG_KEYS)) return false;
  return (value.enabled === undefined || typeof value.enabled === 'boolean')
    && (value.volume === undefined || isFiniteInRange(value.volume, 0, 800))
    && (value.muted === undefined || typeof value.muted === 'boolean')
    && (value.compressor === undefined || typeof value.compressor === 'boolean')
    && (value.mono === undefined || typeof value.mono === 'boolean')
    && (value.bass === undefined || typeof value.bass === 'boolean')
    && (value.eqValues === undefined || (
      Array.isArray(value.eqValues)
      && value.eqValues.length === 10
      && value.eqValues.every((item) => isFiniteInRange(item, -12, 12))
    ))
    && (value.pan === undefined || isFiniteInRange(value.pan, -1, 1))
    && (value.delay === undefined || isFiniteInRange(value.delay, 0, 500))
    && (value.speed === undefined || isFiniteInRange(value.speed, 0.1, 16));
}

// post: identifies the transparent, never-activated site configuration
export function isDefaultAudioConfig(config: AudioConfig): boolean {
	return config.enabled === DEFAULT_AUDIO_CONFIG.enabled
		&& config.volume === DEFAULT_AUDIO_CONFIG.volume
		&& config.muted === DEFAULT_AUDIO_CONFIG.muted
		&& config.compressor === DEFAULT_AUDIO_CONFIG.compressor
		&& config.mono === DEFAULT_AUDIO_CONFIG.mono
		&& config.bass === DEFAULT_AUDIO_CONFIG.bass
		&& config.pan === DEFAULT_AUDIO_CONFIG.pan
		&& config.delay === DEFAULT_AUDIO_CONFIG.delay
		&& config.speed === DEFAULT_AUDIO_CONFIG.speed
		&& config.eqValues.length === DEFAULT_AUDIO_CONFIG.eqValues.length
		&& config.eqValues.every((value, index) => value === DEFAULT_AUDIO_CONFIG.eqValues[index]);
}

// Types of audio processing engines
export type AudioMode =
  | 'NATIVE_WEBAUDIO'  // direct injection via WebAudio
  | 'NATIVE_LITE'      // lightweight mode for overhead reduction
  | 'CAPTURE'          // browser tab capture mode (prevents CORS issues)
  | 'DISABLED';

// Runtime state of the audio engine
export interface AudioState {
  config: AudioConfig;
  mode: AudioMode;
  hasAudio: boolean;
  isPlaying: boolean;
  userInteracted: boolean;
  corsBlocked: boolean;
}

export type SpectraAudioMode = 'bypass' | 'webaudio' | 'capture';
export type AudioSessionPhase = 'idle' | 'starting' | 'active' | 'stopping' | 'error';

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
    && (value.lastError === null || isAudioSessionError(value.lastError));
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
    && (value.lastError === null || isAudioSessionError(value.lastError));
}

// goal: abstract interface for audio control, implementation in @nexus/audio-engine
export interface IAudioService {
  getState(): AudioState;

  // eff: returns frequency data for visualization
  getVisualizerData(): Float32Array | null;

  setVolume(level: number): Result<void>;

  toggleMute(): Result<boolean>;

  updateConfig(config: Partial<AudioConfig>): Result<void>;

  // eff: switch to tab capture mode, requires user permission
  setCaptureMode(enabled: boolean): Promise<Result<void>>;

  on(event: 'stateChange', handler: (state: AudioState) => void): () => void;

  on(event: 'corsDetected', handler: () => void): () => void;

  init(): Promise<Result<void>>;

  // post: release all hardware and memory resources
  dispose(): void;
}

export interface UrlInfo {
  fullUrl: string;
  domain: string;
  pathname: string;
  isIframe: boolean;
}

// Input for audio mode policy calculation
export interface PolicyContext {
  urlInfo: UrlInfo;
  hasMediaElement: boolean;
  hasAudioContext: boolean;
  userInteracted: boolean;
  enabled: boolean;
  volume: number;
  visualizerEnabled: boolean;
  // rule: force native mode for specific self-healing scenarios
  forceNative: boolean;
  // rule: determined by CORS detection results
  isRestricted?: boolean;
  config?: AudioConfig;
}

// goal: stateless engine to determine optimal audio mode based on environment
export interface IPolicyEngine {
  // eff: compute the best mode for the given context
  calculateMode(context: PolicyContext): AudioMode;

  /** @deprecated v3.0 */
  getRuleForDomain(domain: string): SiteRule | null;
}

/** @deprecated moved to dynamic CORS detection */
export interface SiteRule {
  type: 'whitelist' | 'blacklist' | 'force_capture' | 'force_native';
  pattern: string;
  reason?: string;
}

