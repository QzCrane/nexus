/**
 * NEXUS Kernel - Messages 模块导出
 */

// 协议定义（来自 @nexus/contracts）
export * from './protocol.js';

// 默认值（运行时常量）
export { DEFAULT_AUDIO_CONFIG, DEFAULT_GLOBAL_SETTINGS } from './defaults.js';

// 客户端 (Popup/Content 使用)
export { createMessenger } from './client.js';
export type { NexusMessenger } from './client.js';

// 路由器 (Background 使用)
export { createRouter } from './router.js';
export type { NexusRouter } from './router.js';
