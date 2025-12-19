/**
 * @nexus/contracts - 纯契约层
 * 
 * 这个包只包含接口和类型定义，不含任何业务逻辑。
 * 
 * ## 设计目的
 * 
 * 1. **最小化 AI 上下文** - AI 只需读取这里即可了解所有公共 API
 * 2. **分离关注点** - 契约与实现完全分离
 * 3. **跨包类型共享** - 所有包共用同一套类型定义
 * 
 * ## 使用示例
 * 
 * ```typescript
 * import type { 
 *   IAudioService, 
 *   AudioConfig,
 *   NexusMessages 
 * } from '@nexus/contracts';
 * 
 * // 依赖接口而非具体实现
 * function createPlayer(audioService: IAudioService) {
 *   audioService.setVolume(150);
 * }
 * ```
 * 
 * @packageDocumentation
 */

// ============================================
// 通用类型
// ============================================
export type {
  Result,
  Maybe,
  TabId,
  VolumeLevel,
  DomainName,
  EventHandler,
  Unsubscribe
} from './common.types.js';

// ============================================
// 音频契约
// ============================================
export type {
  AudioConfig,
  AudioMode,
  AudioState,
  IAudioService,
  IPolicyEngine,
  PolicyContext,
  UrlInfo,
  SiteRule
} from './audio.contracts.js';

export { DEFAULT_AUDIO_CONFIG } from './audio.contracts.js';

// ============================================
// 消息契约
// ============================================
export type {
  NexusMessages,
  NexusAction,
  NexusRequest,
  NexusResponse,
  INexusMessenger,
  INexusRouter
} from './messages.contracts.js';

// ============================================
// 设置契约
// ============================================
export type {
  GlobalSettings,
  SupportedLanguage,
  IStorageRepository
} from './settings.contracts.js';

export { DEFAULT_GLOBAL_SETTINGS } from './settings.contracts.js';
