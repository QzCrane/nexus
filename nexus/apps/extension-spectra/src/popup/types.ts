/**
 * SPECTRA Popup - 类型定义
 * 
 * 定义 Popup UI 所需的所有接口和类型
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';

// 重导出 I18N 类型
export { I18NDict, I18NMap } from './types/i18n.types';

// ============================================
// UI 元素引用类型
// ============================================

/** 卡片内 UI 元素引用 */
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
  // 媒体控制
  btnPause: HTMLElement | null;
  btnPip: HTMLElement | null;
  btnHotkeyTarget: HTMLElement | null;
  btnGotoTab: HTMLElement | null;
  speedInput: HTMLInputElement | null;
  speedBtns: NodeListOf<HTMLElement>;
}

/** 设置页 UI 元素引用 */
export interface SettingsUIElements {
  swOsd: HTMLInputElement | null;
  swViz: HTMLInputElement | null;
  selLang: HTMLSelectElement | null;
  txtRegistry: HTMLTextAreaElement | null;
  groupRegistry: HTMLElement | null;
  btnSaveReg: HTMLElement | null;
}

// ============================================
// 状态类型
// ============================================

/** 卡片内部状态 */
export interface CardState {
  config: AudioConfig;
  isCaptureActive: boolean;
  userInteracted: boolean;
  isConnected: boolean;
}

/** EQ 曲线绘制缓存 */
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

// ============================================
// 消息类型 (Legacy 兼容)
// ============================================

/** Content Script 状态响应 */
export interface ContentStatusResponse {
  config: AudioConfig;
  hasAudio: boolean;
  isPlaying: boolean;
  mode: 'NATIVE_WEBAUDIO' | 'NATIVE_LITE' | 'CAPTURE';
  userInteracted: boolean;
}

/** 可视化数据响应 */
export interface VisualizerDataResponse {
  buffer: number[] | null;
}

// ============================================
// 回调类型
// ============================================

export type RenderCallback = () => void;
export type MetricsChangeCallback = () => void;

// ============================================
// 重导出常用类型
// ============================================

export type { AudioConfig, GlobalSettings };
