import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { DomainEntry } from '@nexus/contracts';
import type { CardUIElements, I18NDict } from '../types';

/** Card Internal State */
export interface CardInternalState {
  config: AudioConfig;
  isCaptureActive: boolean;
  userInteracted: boolean;
  isRestrictedSite: boolean;
  actualMode: 'NATIVE_WEBAUDIO' | 'NATIVE_LITE' | 'CAPTURE' | null;
  /** Whether slider is being dragged */
  isDragging: boolean;
}

/** initCard Params */
export interface InitCardParams {
  container: HTMLElement;
  template: HTMLTemplateElement;
  tab: chrome.tabs.Tab;
  dict: I18NDict;
  registryEntries: DomainEntry[];
  getGlobalSettings: () => GlobalSettings;
  isBackground?: boolean;
  /** EQ Curve Drawer callback (from visualizer module) */
  createEqCurveDrawer?: (
    canvas: HTMLCanvasElement,
    sliderRow: HTMLElement,
    getEqValues: () => number[]
  ) => { draw: (color?: string) => void; updateMetrics: () => void };
}

/** Card Context (Passed to sub-modules) */
export interface CardContext {
  tab: chrome.tabs.Tab;
  domain: string;
  ui: CardUIElements;
  state: CardInternalState;
  render: () => void;
  update: (changes: Partial<AudioConfig>) => void;
  getCapturing: () => boolean;
}

export const DEFAULT_CONFIG: AudioConfig = {
  enabled: true,
  volume: 100,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  pan: 0,
  delay: 0,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** Clean Config Object */
export function cleanConfig(config: Partial<AudioConfig> | null): AudioConfig {
  const c = { ...DEFAULT_CONFIG, ...config };
  if (!Array.isArray(c.eqValues)) {
    c.eqValues = [...DEFAULT_CONFIG.eqValues];
  }
  if (c.enabled === undefined) {
    c.enabled = true;
  }
  // Remove temporary fields
  delete (c as any).toggleMute;
  delete (c as any).volumeDelta;
  return c;
}
