/**
 * SPECTRA Popup - 类型定义
 * 
 * 定义 Popup UI 所需的所有接口和类型
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';

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
  /** 当前音频配置 */
  config: AudioConfig;
  /** 是否正在 Capture 模式 */
  isCaptureActive: boolean;
  /** 用户是否已交互 */
  userInteracted: boolean;
  /** 连接是否建立 */
  isConnected: boolean;
}

/** EQ 曲线绘制缓存 */
export interface MetricsCacheData {
  /** EQ 滑块行元素 */
  row: HTMLElement;
  /** EQ 曲线画布 */
  canvas: HTMLCanvasElement;
  /** X 坐标数组 (10个滑块位置) */
  xCoords: Float32Array;
  /** 中心 Y 坐标 */
  midY: number;
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** 设备像素比 */
  dpr: number;
  /** 缩放因子 */
  scaleFactor: number;
  /** 是否有效 */
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
// I18N 类型
// ============================================

/** 国际化字典项 */
export interface I18NDict {
  settingsTitle: string;
  osdLabel: string;
  osdSub: string;
  vizLabel: string;
  vizSub: string;
  vizDesc: string;
  langLabel: string;
  noAudio: string;
  bgTitle: string;
  paused: string;
  clickToResume: string;
  comp: string;
  bass: string;
  mono: string;
  eqTitle: string;
  reset: string;
  save: string;
  resetTooltip: string;
  saveTooltip: string;
  captureListLabel: string;
  captureListSub: string;
  grpInterface: string;
  grpGeneral: string;
  grpAdvanced: string;
  // 注册表 UI
  tabRestricted: string;
  tabSafe: string;
  filterPlaceholder: string;
  registryHint: string;
  autoAddedToast: (domain: string) => string;
  // 主题相关
  themeLabel: string;
  themeSub: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  // 导航按钮 tooltip
  btnThemeTooltip: string;
  btnSettingsTooltip: string;
  btnShortcutsTooltip: string;
}

/** 所有语言的 I18N 映射 */
export type I18NMap = Record<string, I18NDict>;

// ============================================
// 回调类型
// ============================================

/** 卡片渲染回调 */
export type RenderCallback = () => void;

/** MetricsCache 变化回调 */
export type MetricsChangeCallback = () => void;

// ============================================
// 重导出常用类型
// ============================================

export type { AudioConfig, GlobalSettings };
