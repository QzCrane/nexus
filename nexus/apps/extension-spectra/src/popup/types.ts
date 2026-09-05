// goal: centralizes type definitions for the SPECTRA popup UI, element mapping, and transient state

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';

export type { I18NDict, I18NMap } from './types/i18n.types';

// CardUIElements: DOM references for a single tab management card
export interface CardUIElements {
  card: HTMLElement;
  title: HTMLElement;
  domain: HTMLElement;
  icon: HTMLImageElement;
  enable: HTMLInputElement;
  mask: HTMLElement;
  maskText: HTMLElement;
  slider: HTMLInputElement;
  fill: HTMLElement;
  val: HTMLElement;
  mute: HTMLElement;
  btnSave: HTMLElement;
  btnReset: HTMLElement;
  btnSaveGlobal: HTMLElement | null;
  canvas: HTMLCanvasElement;
  sliderArea: HTMLElement;
  vizIsland: HTMLElement | null;
  btnPause: HTMLElement | null;
  btnPip: HTMLElement | null;
  btnHotkeyTarget: HTMLElement | null;
  btnGotoTab: HTMLElement | null;
  speedInput: HTMLInputElement | null;
  speedBtns: NodeListOf<HTMLElement>;
}

// SettingsUIElements: DOM references for the global settings view in the side panel
export interface SettingsUIElements {
  swOsd: HTMLInputElement | null;
  swViz: HTMLInputElement | null;
  selLang: HTMLSelectElement | null;
}

// CardState: UI-specific transient state for a tab card
export interface CardState {
  config: AudioConfig;
  isCaptureActive: boolean;
  userInteracted: boolean;
  isConnected: boolean;
}

export type RenderCallback = () => void;

export type { AudioConfig, GlobalSettings };
