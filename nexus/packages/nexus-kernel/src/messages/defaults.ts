/**
 * NEXUS Kernel - 默认值定义
 * 
 * 包含运行时使用的默认配置值。
 */

import type { AudioConfig, GlobalSettings } from '@nexus/contracts';

/** 音频配置的默认值 */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  enabled: true,
  volume: 100,
  muted: false,
  compressor: false,
  mono: false,
  bass: false,
  eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pan: 0,
  delay: 0
};

/** 全局设置默认值 */
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  osdEnabled: true,
  visualizerEnabled: true,
  lang: 'en-US',
  themeMode: 'system',
  pauseRetentionSeconds: 60
};
