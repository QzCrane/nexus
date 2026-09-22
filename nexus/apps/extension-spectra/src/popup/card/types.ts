// goal: defines internal types, state interfaces, and configuration defaults for the popup tab card component

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { AudioRuntimeStatus, AudioSessionSnapshot, ControlFieldStates, ControlSnapshot } from '@nexus/contracts';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import type {
  AudioSessionError,
  AudioSessionPhase,
  SpectraAudioMode,
} from '@nexus/contracts';
import {
  resolveAudioVolume,
} from '@nexus/contracts';
import {
	compileEffectiveVolume,
	splitEffectiveVolume,
} from '@nexus/contracts/ui-runtime';
import type { CardUIElements, I18NDict } from '../types';
import type { VizLoopController, VizLoopParams } from '../visualizer/loop';

export interface CardInternalState {
  config: AudioConfig;
  stableConfig: AudioConfig;
  controlSnapshot: ControlSnapshot | null;
  controlSnapshotKnown?: boolean;
  lifecycleSnapshotKnown?: boolean;
  isCaptureActive: boolean;
  userInteracted: boolean;
  actualMode: SpectraAudioMode;
  desiredMode: SpectraAudioMode;
  phase: AudioSessionPhase;
  controlGeneration: number;
  controlRevision: number;
  audioDocumentId: string | null;
  audioOrigin: string | null;
  audioGeneration: number;
  audioConfigRevision: number;
  lastError: AudioSessionError | null;
  draggingField: 'volume' | null;
}

export type VizLoopFactory = (params: VizLoopParams) => VizLoopController;

export interface PopupVisualizerFactories {
  createVizLoop: VizLoopFactory;
}

export type CardObservationReason = 'capacity' | 'rejected' | 'stale' | 'timeout' | 'unavailable';
export type CardObservation<T> =
	| { state: 'known'; value: T }
	| { state: 'unknown'; reason: CardObservationReason };

export interface CardSnapshot {
  documentId: string;
  status: CardObservation<AudioRuntimeStatus>;
  controlSnapshot: CardObservation<ControlSnapshot>;
  sessionSnapshot: CardObservation<AudioSessionSnapshot | null>;
  isRemoteActive: CardObservation<boolean>;
}

export interface InitCardParams {
  container: HTMLElement;
  template: HTMLTemplateElement;
  tab: chrome.tabs.Tab;
  dict: I18NDict;
  getGlobalSettings: () => GlobalSettings;
  getDictionary?: () => I18NDict;
  onCardSetChanged?: () => void;
  isBackground?: boolean;
  loadVisualizer?: () => Promise<PopupVisualizerFactories>;
  registerCleanup?: (cleanup: () => void) => () => void;
}

// CardContext: unified handle passed to sub-modules (rendering, messaging, events) to access shared tab state and UI refs
export interface CardContext {
  tab: chrome.tabs.Tab;
  domain: string;
  ui: CardUIElements;
  state: CardInternalState;
  render: () => void;
  update: (changes: Partial<AudioConfig>) => void;
  getCapturing: () => boolean;
}

// post: returns deep-merged and validated AudioConfig object, ensuring eqValues array presence and removing transient command fields
export function cleanConfig(config: Partial<AudioConfig> | null): AudioConfig {
  const c = mergeAudioConfig(DEFAULT_AUDIO_CONFIG, config ?? {});
  if (!Array.isArray(c.eqValues)) {
    c.eqValues = [...DEFAULT_AUDIO_CONFIG.eqValues];
  }
  if (c.enabled === undefined) {
    c.enabled = true;
  }
  // note: strip internal command triggers used for temporary sync that shouldn't persist in the configuration state
  Reflect.deleteProperty(c, 'toggleMute');
  Reflect.deleteProperty(c, 'volumeDelta');
  return c;
}

// post: the effective product projection and its physical pair are updated
// atomically so no UI surface can collapse 50% x 2 into 100% x 1.
export function mergeAudioConfig(
  current: AudioConfig,
  changes: Partial<AudioConfig>,
): AudioConfig {
  const merged = { ...current, ...changes };
  const effectiveVolume = changes.volume;
  const effectiveOnly = effectiveVolume !== undefined
    && changes.volumeBase === undefined
    && changes.boost === undefined;
  const volume = effectiveOnly
    ? splitEffectiveVolume(effectiveVolume ?? 100)
    : resolveAudioVolume({
      volumeBase: merged.volumeBase,
      boost: merged.boost,
    });
  return {
    ...merged,
    volumeBase: volume.volumeBase,
    boost: volume.boost,
    volume: compileEffectiveVolume(volume.volumeBase, volume.boost),
  };
}

// Snapshot fields are actual cross-surface control state. Project only audio
// fields understood by the current card and preserve every unrelated config
// value until its owning control migrates to the coordinator.
export function mergeControlSnapshot(
  current: AudioConfig,
  snapshot: ControlSnapshot | null,
): AudioConfig {
  return snapshot ? mergeControlFields(current, snapshot.fields) : current;
}

// ControlSnapshot is the sole field-level actual authority. AudioSessionSnapshot
// owns only processor lifecycle, so initial card fields start neutral and are
// projected exclusively from the current control snapshot.
export function initialControlConfig(snapshot: ControlSnapshot | null): AudioConfig {
  return mergeControlSnapshot(cleanConfig(DEFAULT_AUDIO_CONFIG), snapshot);
}

export function mergeControlFields(
  current: AudioConfig,
  fields: ControlFieldStates,
): AudioConfig {
  const changes: Partial<AudioConfig> = {};
  const actual = <K extends keyof ControlFieldStates>(field: K) =>
    fields[field]?.phase === 'applied' ? fields[field]?.actual : undefined;
  const audioEnabled = actual('audioEnabled');
  const volumeBase = actual('volumeBase');
  const boost = actual('boost');
  const mediaMuted = actual('mediaMuted');
  const speed = actual('speed');
  const preservePitch = actual('preservePitch');
  const eqValues = actual('eqValues');
  const bass = actual('bass');
  const compressor = actual('compressor');
  const mono = actual('mono');
  const pan = actual('pan');
  const delay = actual('delay');
  if (typeof audioEnabled === 'boolean') changes.enabled = audioEnabled;
  if (typeof volumeBase === 'number') changes.volumeBase = volumeBase;
  if (typeof boost === 'number') changes.boost = boost;
  if (typeof mediaMuted === 'boolean') changes.muted = mediaMuted;
  if (typeof speed === 'number') changes.speed = speed;
  if (typeof preservePitch === 'boolean') changes.preservePitch = preservePitch;
  if (Array.isArray(eqValues)) changes.eqValues = [...eqValues];
  if (typeof bass === 'boolean') changes.bass = bass;
  if (typeof compressor === 'boolean') changes.compressor = compressor;
  if (typeof mono === 'boolean') changes.mono = mono;
  if (typeof pan === 'number') changes.pan = pan;
  if (typeof delay === 'number') changes.delay = delay;
  return mergeAudioConfig(current, changes);
}
