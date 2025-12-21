/**
 * NEXUS Kernel - Storage Repository
 * 
 * 封装 chrome.storage.local，提供类型安全的存储访问。
 * 
 * 使用方式:
 * ```typescript
 * import { StorageRepository } from '@nexus/kernel/storage';
 * 
 * const storage = new StorageRepository();
 * 
 * // 获取音频配置 (返回强类型)
 * const config = await storage.getAudioConfig('youtube.com');
 * 
 * // 保存配置
 * await storage.setAudioConfig('youtube.com', { volume: 200 });
 * ```
 */

import {
  AudioConfig,
  DEFAULT_AUDIO_CONFIG,
  GlobalSettings,
  DEFAULT_GLOBAL_SETTINGS
} from '../messages/protocol.js';

/** Storage Key 常量 */
const STORAGE_KEYS = {
  SITE_SETTINGS: 'siteSettings',
  GLOBAL_SETTINGS: 'globalSettings',
  USER_REGISTRY: 'userRegistry'
} as const;

/** 站点配置映射类型 */
type SiteSettingsMap = Record<string, AudioConfig>;

/**
 * 类型安全的 Storage 仓库
 * 
 * 设计原则:
 * 1. 禁止 UI 组件直接调用 chrome.storage
 * 2. 所有存储操作必须通过此类
 * 3. 返回值必须有默认值，避免 undefined
 */
export class StorageRepository {

  // ========== 音频配置 ==========

  /**
   * 获取指定域名的音频配置
   * 
   * @param domain - 域名 (如 'youtube.com')
   * @returns 音频配置 (如果不存在则返回默认值)
   */
  async getAudioConfig(domain: string): Promise<AudioConfig> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
    const siteSettings: SiteSettingsMap = result[STORAGE_KEYS.SITE_SETTINGS] || {};

    return siteSettings[domain]
      ? { ...DEFAULT_AUDIO_CONFIG, ...siteSettings[domain] }
      : { ...DEFAULT_AUDIO_CONFIG };
  }

  /**
   * 保存指定域名的音频配置
   * 
   * @param domain - 域名
   * @param config - 音频配置 (可以是部分配置)
   */
  async setAudioConfig(domain: string, config: Partial<AudioConfig>): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
    const siteSettings: SiteSettingsMap = result[STORAGE_KEYS.SITE_SETTINGS] || {};

    // 合并配置
    siteSettings[domain] = { ...DEFAULT_AUDIO_CONFIG, ...siteSettings[domain], ...config };

    await chrome.storage.local.set({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });
  }

  /**
   * 删除指定域名的音频配置
   * 
   * @param domain - 域名
   */
  async removeAudioConfig(domain: string): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SITE_SETTINGS);
    const siteSettings: SiteSettingsMap = result[STORAGE_KEYS.SITE_SETTINGS] || {};

    delete siteSettings[domain];

    await chrome.storage.local.set({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });
  }

  // ========== 全局设置 ==========

  /**
   * 获取全局设置
   * 
   * @returns 全局设置 (如果不存在则返回默认值)
   */
  async getGlobalSettings(): Promise<GlobalSettings> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_SETTINGS);

    return result[STORAGE_KEYS.GLOBAL_SETTINGS]
      ? { ...DEFAULT_GLOBAL_SETTINGS, ...result[STORAGE_KEYS.GLOBAL_SETTINGS] }
      : { ...DEFAULT_GLOBAL_SETTINGS };
  }

  /**
   * 更新全局设置
   * 
   * @param settings - 全局设置 (可以是部分设置)
   */
  async setGlobalSettings(settings: Partial<GlobalSettings>): Promise<void> {
    const current = await this.getGlobalSettings();
    const merged = { ...current, ...settings };

    await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_SETTINGS]: merged });
  }

  // ========== 用户注册表 (强制劫持域名列表) ==========

  /**
   * 获取用户注册的强制劫持域名列表
   * 
   * @returns 域名数组
   */
  async getUserRegistry(): Promise<string[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.USER_REGISTRY);
    return result[STORAGE_KEYS.USER_REGISTRY] || [];
  }

  /**
   * 添加域名到用户注册表
   * 
   * @param domain - 域名
   * @returns 是否添加成功 (如果已存在则返回 false)
   */
  async addToUserRegistry(domain: string): Promise<boolean> {
    const registry = await this.getUserRegistry();

    // 检查是否已存在 (包括子域名匹配)
    const exists = registry.some(d => domain.includes(d) || d.includes(domain));
    if (exists) {
      return false;
    }

    registry.push(domain);
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_REGISTRY]: registry });
    return true;
  }

  /**
   * 从用户注册表移除域名
   * 
   * @param domain - 域名
   */
  async removeFromUserRegistry(domain: string): Promise<boolean> {
    const registry = await this.getUserRegistry();
    const initialLength = registry.length;
    const filtered = registry.filter(d => d !== domain);

    if (filtered.length !== initialLength) {
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_REGISTRY]: filtered });
      return true;
    }
    return false;
  }

  /**
   * 设置完整的用户注册表 (覆盖)
   * 
   * @param registry - 域名数组
   */
  async setUserRegistry(registry: string[]): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_REGISTRY]: registry });
  }

  // ========== 监听变化 ==========

  /**
   * 监听存储变化
   * 
   * @param callback - 变化回调
   * @returns 取消监听的函数
   */
  onChanged(
    callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
  ): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        callback(changes);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }
}
