/**
 * SPECTRA Popup - 音频参数常量
 * 
 * 从 @nexus/audio-engine 导入核心常量，Popup 专用常量在此定义
 */

// 注意：核心音频常量已在 @nexus/audio-engine 中定义
// 这里仅定义 Popup UI 专用的音频相关常量

/** Popup UI 专用音频常量 */
export const AUDIO_UI = {
  /** 最大音量 (%) - 用于滑块范围 */
  MAX_VOLUME: 800,
  /** 音量调节步进 - 滚轮调节时使用 */
  VOLUME_STEP: 10,
  /** EQ 最小值 (dB) */
  EQ_MIN: -12,
  /** EQ 最大值 (dB) */
  EQ_MAX: 12,
  /** EQ 调节步进 (dB) */
  EQ_STEP: 0.1,
} as const;

/** 默认 EQ 值 (10段全0) */
export const DEFAULT_EQ_VALUES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
