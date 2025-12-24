/**
 * 全局设置契约 (Settings Contracts)
 * 
 * 定义全局设置的类型和默认值。
 * 
 * @packageDocumentation
 */

// ============================================
// 全局设置
// ============================================

/**
 * 主题模式
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 全局设置
 */
export interface GlobalSettings {
  /** 是否启用 OSD (On-Screen Display) */
  osdEnabled: boolean;
  /** 是否启用可视化器 */
  visualizerEnabled: boolean;
  /** 语言 */
  lang: SupportedLanguage;
  /** 主题模式 */
  themeMode: ThemeMode;
  /** 暂停保留时间 (秒)，音频暂停后保留在UI中的时间，0=永久 */
  pauseRetentionSeconds: number;
}

/**
 * 支持的语言
 */
export type SupportedLanguage =
  | 'en-US'
  | 'zh-CN'
  | 'zh-TW'
  | 'ja-JP'
  | 'ko-KR'
  | 'ru-RU'
  | 'de-DE'
  | 'fr-FR';

/**
 * 全局设置默认值
 */
export const DEFAULT_GLOBAL_SETTINGS: Readonly<GlobalSettings> = {
  osdEnabled: true,
  visualizerEnabled: true,
  lang: 'en-US',
  themeMode: 'system',
  pauseRetentionSeconds: 60
} as const;

// ============================================
// 存储接口
// ============================================

/**
 * 存储仓库接口
 * 
 * 抽象 chrome.storage API，提供类型安全的存储访问。
 */
export interface IStorageRepository {
  // ========== 音频配置 ==========

  /** 获取指定域名的音频配置 */
  getAudioConfig(domain: string): Promise<import('./audio.contracts.js').AudioConfig>;

  /** 保存域名的音频配置 */
  setAudioConfig(domain: string, config: Partial<import('./audio.contracts.js').AudioConfig>): Promise<void>;

  // ========== 全局设置 ==========

  /** 获取全局设置 */
  getGlobalSettings(): Promise<GlobalSettings>;

  /** 保存全局设置 */
  setGlobalSettings(settings: Partial<GlobalSettings>): Promise<void>;

  // ========== 通用 ==========

  /** 监听存储变化 */
  onChanged(callback: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void): () => void;

  /** 清除所有数据 */
  clear(): Promise<void>;
}
