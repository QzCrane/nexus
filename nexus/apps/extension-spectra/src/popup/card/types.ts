import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { CardUIElements, I18NDict } from '../types';

/** 卡片内部状态 */
export interface CardInternalState {
  /** 当前音频配置 */
  config: AudioConfig;
  /** 是否 Capture 模式激活 (从 Background 获取) */
  isCaptureActive: boolean;
  /** 用户是否已交互 */
  userInteracted: boolean;
  /** 是否受限站点 */
  isRestrictedSite: boolean;
  /** Content Script 返回的实际模式 */
  actualMode: 'NATIVE_WEBAUDIO' | 'NATIVE_LITE' | 'CAPTURE' | null;
  /** 用户是否正在拖动滑块 (用于防止状态同步导致的回跳闪烁) */
  isDragging: boolean;
}

/** initCard 参数 */
export interface InitCardParams {
  container: HTMLElement;
  template: HTMLTemplateElement;
  tab: chrome.tabs.Tab;
  dict: I18NDict;
  userRegistry: string[];
  getGlobalSettings: () => GlobalSettings;
  /** EQ 曲线绘制回调 (由 visualizer 模块提供) */
  createEqCurveDrawer?: (
    canvas: HTMLCanvasElement,
    sliderRow: HTMLElement,
    getEqValues: () => number[]
  ) => { draw: (color?: string) => void; updateMetrics: () => void };
}

/** 卡片上下文 (传递给各子模块) */
export interface CardContext {
  /** 标签页信息 */
  tab: chrome.tabs.Tab;
  /** 域名 */
  domain: string;
  /** UI 元素引用 */
  ui: CardUIElements;
  /** 状态 (可变) */
  state: CardInternalState;
  /** 渲染函数引用 */
  render: () => void;
  /** 更新配置并同步 */
  update: (changes: Partial<AudioConfig>) => void;
  /** 获取当前 Capture 状态 */
  getCapturing: () => boolean;
}

/** 默认音频配置 */
export const DEFAULT_CONFIG: AudioConfig = {
  enabled: true,
  volume: 100,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** 清理配置对象，确保所有字段存在 */
export function cleanConfig(config: Partial<AudioConfig> | null): AudioConfig {
  const c = { ...DEFAULT_CONFIG, ...config };
  if (!Array.isArray(c.eqValues)) {
    c.eqValues = [...DEFAULT_CONFIG.eqValues];
  }
  if (c.enabled === undefined) {
    c.enabled = true;
  }
  return c;
}
