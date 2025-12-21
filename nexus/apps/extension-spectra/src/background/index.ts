/**
 * SPECTRA - Background Service Worker (入口)
 * 
 * 核心职责:
 * 1. 处理来自 Popup/Content 的 RPC 消息
 * 2. 管理 Tab Capture 状态
 * 3. 更新扩展图标角标
 * 4. 处理快捷键事件
 * 
 * 模块结构:
 * - state.ts       状态管理
 * - helpers.ts     辅助函数
 * - handlers/      消息处理器
 * - shortcuts.ts   快捷键处理
 * - lifecycle.ts   Tab 生命周期
 */

import { router } from './state';
import { registerAudioHandlers } from './handlers/audio';
import { registerSettingsHandlers } from './handlers/settings';
import { registerCaptureHandlers } from './handlers/capture';
import { registerBadgeHandlers } from './handlers/badge';
import { registerRegistryHandlers } from './handlers/registry';
import { registerTabStateHandlers } from './handlers/tab-state';
import { setupShortcutListeners } from './shortcuts';
import { setupLifecycleListeners } from './lifecycle';
import { swLog } from '../shared/logger';

// ============================================
// 注册所有消息处理器
// ============================================

registerAudioHandlers();
registerSettingsHandlers();
registerCaptureHandlers();
registerBadgeHandlers();
registerRegistryHandlers();
registerTabStateHandlers();

// ============================================
// 设置事件监听器
// ============================================

setupShortcutListeners();
setupLifecycleListeners();

// ============================================
// 启动消息路由
// ============================================

router.listen();

swLog.info('Background Service Worker started.');
