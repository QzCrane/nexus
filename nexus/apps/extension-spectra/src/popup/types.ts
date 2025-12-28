/**
 * SPECTRA Popup - Type Definitions
 * 
 * Interface definitions for Popup UI.
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';

export type { I18NDict, I18NMap } from './types/i18n.types';

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
  comp: HTMLInputElement;
  bass: HTMLInputElement;
  mono: HTMLInputElement;
  eqTrigger: HTMLElement;
  eqDrawer: HTMLElement;
  eqInputs: NodeListOf<HTMLInputElement>;
  eqVals: NodeListOf<HTMLElement>;
  btnSave: HTMLElement;
  btnReset: HTMLElement;
  canvas: HTMLCanvasElement;
  sliderArea: HTMLElement;
  tComp: HTMLElement;
  tBass: HTMLElement;
  tMono: HTMLElement;
  tEq: HTMLElement;
  vizIsland: HTMLElement | null;
  // Media Controls
  btnPause: HTMLElement | null;
  btnPip: HTMLElement | null;
  btnHotkeyTarget: HTMLElement | null;
  btnGotoTab: HTMLElement | null;
  speedInput: HTMLInputElement | null;
  speedBtns: NodeListOf<HTMLElement>;
}

export interface SettingsUIElements {
  swOsd: HTMLInputElement | null;
  swViz: HTMLInputElement | null;
  selLang: HTMLSelectElement | null;
  txtRegistry: HTMLTextAreaElement | null;
  groupRegistry: HTMLElement | null;
  btnSaveReg: HTMLElement | null;
}

export interface CardState {
  config: AudioConfig;
  isCaptureActive: boolean;
  userInteracted: boolean;
  isConnected: boolean;
}

export interface MetricsCacheData {
  row: HTMLElement;
  canvas: HTMLCanvasElement;
  xCoords: Float32Array;
  midY: number;
  width: number;
  height: number;
  dpr: number;
  scaleFactor: number;
  isValid: boolean;
}

export interface ContentStatusResponse {
  config: AudioConfig;
  hasAudio: boolean;
  isPlaying: boolean;
  mode: 'NATIVE_WEBAUDIO' | 'NATIVE_LITE' | 'CAPTURE';
  userInteracted: boolean;
  // Null means playing
  pausedAt: number | null;
}

export interface VisualizerDataResponse {
  buffer: number[] | null;
}

export type RenderCallback = () => void;
export type MetricsChangeCallback = () => void;

export type { AudioConfig, GlobalSettings };
