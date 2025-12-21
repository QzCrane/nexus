/**
 * NEXUS Kernel - 消息协议定义 (Message Protocol)
 * 
 * ⚠️ 已迁移到 @nexus/contracts，此文件仅保留用于向后兼容。
 * 新代码请直接从 @nexus/contracts 导入。
 * 
 * @deprecated 请使用 import type { ... } from '@nexus/contracts';
 */

// 重新导出 contracts 中的类型（向后兼容）
export type {
  // 音频配置
  AudioConfig,
  AudioState,
  AudioMode,
  
  // 消息协议
  NexusMessages,
  NexusAction,
  NexusRequest,
  NexusResponse,
  
  // 全局设置
  GlobalSettings,
  SupportedLanguage,
} from '@nexus/contracts';

// 导入并重新导出默认值（这些是运行时值，不是类型）
import { DEFAULT_AUDIO_CONFIG, DEFAULT_GLOBAL_SETTINGS } from './defaults.js';
export { DEFAULT_AUDIO_CONFIG, DEFAULT_GLOBAL_SETTINGS };
