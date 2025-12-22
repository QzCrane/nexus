/**
 * NEXUS Kernel - Storage Repository
 * 
 * 统一导出拆分后的存储模块，保持向后兼容
 */

import {
  AudioConfig, DEFAULT_AUDIO_CONFIG,
  GlobalSettings, DEFAULT_GLOBAL_SETTINGS
} from '../messages/protocol.js';

import * as audioConfig from './audio-config.js';
import * as globalSettings from './global-settings.js';
import * as userRegistry from './user-registry.js';
import * as restrictedRegistry from './restricted-registry.js';

/** 类型安全的 Storage 仓库 (兼容层) */
export class StorageRepository {
  // 音频配置
  getAudioConfig = audioConfig.getAudioConfig;
  setAudioConfig = audioConfig.setAudioConfig;
  removeAudioConfig = audioConfig.removeAudioConfig;

  // 全局设置
  getGlobalSettings = globalSettings.getGlobalSettings;
  setGlobalSettings = globalSettings.setGlobalSettings;

  // 用户注册表 (旧接口，保持兼容)
  getUserRegistry = userRegistry.getUserRegistry;
  addToUserRegistry = userRegistry.addToUserRegistry;
  removeFromUserRegistry = userRegistry.removeFromUserRegistry;
  setUserRegistry = userRegistry.setUserRegistry;

  // 受限注册表 (新接口，三合一)
  registry = {
    init: restrictedRegistry.initRegistry,
    get: restrictedRegistry.getRegistry,
    query: restrictedRegistry.queryDomain,
    isRestricted: restrictedRegistry.isRestricted,
    add: restrictedRegistry.addDomain,
    remove: restrictedRegistry.removeDomain,
    markProbed: restrictedRegistry.markProbed,
    getDomainList: restrictedRegistry.getDomainList,
    set: restrictedRegistry.setRegistry,
  };

  /** 监听存储变化 */
  onChanged(callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}

