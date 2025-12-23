/**
 * NEXUS Kernel - 主入口
 * 
 * @packageDocumentation
 * 
 * NEXUS Kernel 是 Project NEXUS 的核心通信层，提供:
 * 1. Typed RPC Bus - 类型安全的消息通信
 * 2. Storage Repository - 类型安全的存储访问
 * 
 * @example
 * ```typescript
 * // 在 Background Service Worker 中
 * import { createRouter, StorageRepository } from '@nexus/kernel';
 * 
 * const router = createRouter();
 * const storage = new StorageRepository();
 * 
 * router.on('AUDIO_GET_STATUS', async (_, sender) => {
 *   const config = await storage.getAudioConfig('youtube.com');
 *   return { config, hasAudio: true, ... };
 * });
 * 
 * router.listen();
 * ```
 * 
 * @example
 * ```typescript
 * // 在 Popup 中
 * import { createMessenger } from '@nexus/kernel';
 * 
 * const messenger = createMessenger('popup');
 * const status = await messenger.send('AUDIO_GET_STATUS');
 * ```
 */

// 消息通信
export * from './messages/index.js';

// 存储访问
export * from './storage/index.js';

// 日志
export * from './logger.js';

