/**
 * 音频服务契约 (Audio Service Contracts)
 * 
 * 定义音频引擎的所有公共接口和类型。
 * AI 在编写任何需要音频功能的代码时，只需读取此文件即可。
 * 
 * @packageDocumentation
 */

import type { Result, VolumeLevel, TabId } from './common.types.js';

// ============================================
// 数据类型 (Data Types)
// ============================================

/**
 * 音频配置
 * 
 * 存储每个标签页/域名的音频设置。
 */
export interface AudioConfig {
  /** 是否启用音频处理 */
  enabled: boolean;
  /** 音量 (0-800，100 为原始音量) */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 是否启用压缩器 (防爆音) */
  compressor: boolean;
  /** 是否强制单声道 */
  mono: boolean;
  /** 是否启用低音增强 */
  bass: boolean;
  /** 10段均衡器值 (-12 到 +12) */
  eqValues: number[];
}

/**
 * 音频配置默认值
 */
export const DEFAULT_AUDIO_CONFIG: Readonly<AudioConfig> = {
  enabled: true,
  volume: 100,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
} as const;

/**
 * 音频处理模式
 */
export type AudioMode =
  | 'NATIVE_WEBAUDIO'  // 原生 WebAudio API 注入
  | 'NATIVE_LITE'      // 轻量模式 (仅音量)
  | 'CAPTURE'          // Tab Capture 模式
  | 'DISABLED';        // 禁用

/**
 * 音频状态 (运行时)
 */
export interface AudioState {
  /** 当前配置 */
  config: AudioConfig;
  /** 当前模式 */
  mode: AudioMode;
  /** 是否有音频元素 */
  hasAudio: boolean;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 用户是否已交互过 */
  userInteracted: boolean;
  /** 是否检测到 CORS */
  corsBlocked: boolean;
}

// ============================================
// 服务接口 (Service Interfaces) - The Contract
// ============================================

/**
 * 音频服务接口
 * 
 * AI 在编写使用音频服务的代码时，只需了解这个接口。
 * 具体实现细节位于 `@nexus/audio-engine` 内部。
 * 
 * @example
 * ```typescript
 * function createPlayer(audioService: IAudioService) {
 *   audioService.setVolume(150);
 *   audioService.on('stateChange', state => console.log(state));
 * }
 * ```
 */
export interface IAudioService {
  // ========== 查询 ==========

  /** 获取当前音频状态 */
  getState(): AudioState;

  /** 获取可视化数据 (频谱分析) */
  getVisualizerData(): Float32Array | null;

  // ========== 命令 ==========

  /** 设置音量 */
  setVolume(level: number): Result<void>;

  /** 切换静音 */
  toggleMute(): Result<boolean>;

  /** 更新配置 (部分更新) */
  updateConfig(config: Partial<AudioConfig>): Result<void>;

  /** 切换 Capture 模式 */
  setCaptureMode(enabled: boolean): Promise<Result<void>>;

  // ========== 事件 ==========

  /** 监听状态变化 */
  on(event: 'stateChange', handler: (state: AudioState) => void): () => void;

  /** 监听 CORS 检测 */
  on(event: 'corsDetected', handler: () => void): () => void;

  // ========== 生命周期 ==========

  /** 初始化服务 */
  init(): Promise<Result<void>>;

  /** 销毁服务，释放资源 */
  dispose(): void;
}

// ============================================
// 策略引擎接口
// ============================================

/**
 * URL 信息
 */
export interface UrlInfo {
  fullUrl: string;
  domain: string;
  pathname: string;
  isIframe: boolean;
}

/**
 * 策略上下文
 */
export interface PolicyContext {
  urlInfo: UrlInfo;
  hasMediaElement: boolean;
  hasAudioContext: boolean;
  userInteracted: boolean;
  /** 插件是否启用 */
  enabled: boolean;
  /** 当前音量 */
  volume: number;
  /** 频谱是否开启 */
  visualizerEnabled: boolean;
  /** 是否强制原生模式 (用于自愈/排除特定干扰) */
  forceNative: boolean;
  /** 是否为受限站点 (由 CORS 检测结果决定) */
  isRestricted?: boolean;
  /** 完整音频配置 (用于检测高级需求: EQ/压缩/低音) */
  config?: AudioConfig;
}

/**
 * 策略引擎接口 (v3.2 - 纯计算，无状态)
 * 
 * 决定在特定网站上应该使用哪种音频处理模式。
 * 受限判断由调用方通过 context.isRestricted 传入。
 */
export interface IPolicyEngine {
  /** 计算应该使用的音频模式 */
  calculateMode(context: PolicyContext): AudioMode;

  /** @deprecated v3.0 不使用 */
  getRuleForDomain(domain: string): SiteRule | null;
}

/**
 * 站点规则 (v3.2 已废弃，仅保留类型兼容)
 * @deprecated 使用 CORS 动态检测代替
 */
export interface SiteRule {
  type: 'whitelist' | 'blacklist' | 'force_capture' | 'force_native';
  pattern: string;
  reason?: string;
}

