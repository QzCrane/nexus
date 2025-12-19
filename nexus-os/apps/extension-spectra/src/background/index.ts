/**
 * SPECTRA - Background Service Worker
 * 
 * 核心职责:
 * 1. 处理来自 Popup/Content 的 RPC 消息
 * 2. 管理 Tab Capture 状态
 * 3. 更新扩展图标角标
 * 4. 处理快捷键事件
 */

import { 
  createRouter, 
  StorageRepository,
  type AudioConfig,
  type GlobalSettings,
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_GLOBAL_SETTINGS
} from '@nexus/kernel';

// ============================================
// 类型定义
// ============================================

/** 角标状态信息 */
interface BadgeInfo {
  volume: number;
  muted: boolean;
  isCapture: boolean;
  text: string;
}

/** 颜色常量 - 与原 config.js COLORS 一致 */
const BADGE_COLORS = {
  CAPTURE: '#7c3aed',   // 紫色 - 劫持模式
  NATIVE: '#2563eb',    // 蓝色 - 原生模式
  MUTED: '#9ca3af',     // 灰色 - 静音
  WHITE: '#ffffff'
} as const;

// ============================================
// 状态管理
// ============================================

const router = createRouter();
const storage = new StorageRepository();

/** Capture 状态映射 (tabId -> isActive) */
const captureStates = new Map<number, boolean>();

/** Capture 互斥锁 (tabId -> isLocked)，防止同一标签页重复请求 */
const captureLocks = new Map<number, boolean>();

/** 角标状态映射 (tabId -> BadgeInfo)，用于跟踪每个标签页的角标 */
const badgeState = new Map<number, BadgeInfo>();

// ============================================
// Tab 状态辅助函数
// ============================================

/**
 * 检查标签页是否存在
 * @param tabId - 标签页 ID
 * @returns 是否存在
 */
async function isTabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保 Offscreen Document 存在
 * Offscreen 用于处理 Tab Capture 的音频流
 */
async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'] as chrome.offscreen.Reason[],
      justification: 'Audio processing and visualizer'
    });
  }
}

/**
 * 清理指定标签页的所有状态
 * @param tabId - 标签页 ID
 */
function cleanupTabState(tabId: number): void {
  captureStates.delete(tabId);
  captureLocks.delete(tabId);
  badgeState.delete(tabId);
}

// ============================================
// 消息处理器注册
// ============================================

// 获取音频状态
router.on('AUDIO_GET_STATUS', async (_, sender) => {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url || '';
  
  // 从 URL 提取域名
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    // 无效 URL，使用默认配置
  }
  
  const config = await storage.getAudioConfig(domain);
  const isCapture = tabId ? (captureStates.get(tabId) ?? false) : false;
  
  return {
    config,
    hasAudio: true, // 这个需要 content script 报告
    isPlaying: false, // 这个需要 content script 报告
    mode: isCapture ? 'CAPTURE' : 'NATIVE_WEBAUDIO' as const,
    userInteracted: false // 这个需要 content script 跟踪
  };
});

// 更新音频配置
router.on('AUDIO_SET_CONFIG', async (req, sender) => {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url || '';
  
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    return { success: false };
  }
  
  await storage.setAudioConfig(domain, req.config);
  
  // 如果是 Capture 模式，同步配置到 Offscreen
  if (tabId && captureStates.get(tabId)) {
    // TODO: 发送到 Offscreen 更新音频参数
  }
  
  return { success: true };
});

// 获取全局设置
router.on('SETTINGS_GET', async () => {
  return storage.getGlobalSettings();
});

// 更新全局设置
router.on('SETTINGS_UPDATE', async (req) => {
  await storage.setGlobalSettings(req.settings);
  return { success: true };
});

// Capture 模式切换 - 完整实现
router.on('CAPTURE_TOGGLE', async (req, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { status: 'error' as const, error: 'No tab ID' };
  }
  
  // 检查锁 (非阻塞)
  if (captureLocks.get(tabId)) {
    return { status: 'processing' as const };
  }
  
  captureLocks.set(tabId, true);
  
  try {
    if (req.enabled) {
      // 已激活则只更新配置
      if (captureStates.get(tabId)) {
        if (req.config) {
          chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'updateConfig',
            tabId,
            config: req.config
          }).catch(() => {});
        }
        return { status: 'processing' as const };
      }
      
      // 确保 Offscreen 存在
      await ensureOffscreen();
      
      // 获取媒体流 ID
      const streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (sid) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (!sid) {
            reject(new Error('No Stream ID returned'));
          } else {
            resolve(sid);
          }
        });
      });
      
      // 启动 Offscreen 音频处理
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'start',
        tabId,
        streamId,
        config: req.config
      });
      
      captureStates.set(tabId, true);
      
      // 通知 Content Script 和 Popup
      chrome.tabs.sendMessage(tabId, { action: 'captureStateChange', enabled: true }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'captureStateChange', tabId, enabled: true }).catch(() => {});
      
    } else {
      // 停止 Capture
      if (!captureStates.get(tabId)) {
        return { status: 'processing' as const };
      }
      
      chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop', tabId });
      captureStates.set(tabId, false);
      
      // 通知 Content Script 和 Popup
      chrome.tabs.sendMessage(tabId, { action: 'captureStateChange', enabled: false }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'captureStateChange', tabId, enabled: false }).catch(() => {});
    }
    
    return { status: 'processing' as const };
  } catch (e) {
    console.warn(`[SPECTRA] Capture Toggle Failed (Tab ${tabId}):`, e);
    // 通知失败状态
    chrome.tabs.sendMessage(tabId, { action: 'captureStateChange', enabled: false }).catch(() => {});
    return { status: 'error' as const, error: String(e) };
  } finally {
    // 延迟解锁
    setTimeout(() => {
      captureLocks.delete(tabId);
    }, 500);
  }
});

// 获取 Capture 状态
router.on('CAPTURE_GET_STATE', async (req, sender) => {
  const tabId = req.tabId ?? sender.tab?.id;
  if (!tabId) return false;
  return captureStates.get(tabId) ?? false;
});

// 更新角标 - 完整实现
router.on('BADGE_UPDATE', async (req, sender) => {
  const tabId = req.tabId ?? sender.tab?.id;
  if (!tabId) return;
  
  // 先验证标签页是否存在，防止操作已关闭的标签页
  if (!await isTabExists(tabId)) {
    badgeState.delete(tabId);
    return;
  }
  
  const { volume, muted, isCapture } = req;
  
  // 计算角标文字
  let badgeText = '';
  let badgeColor: string = isCapture ? BADGE_COLORS.CAPTURE : BADGE_COLORS.NATIVE;
  
  if (muted || volume === 0) {
    badgeText = 'M';
    badgeColor = BADGE_COLORS.MUTED;
  } else {
    // 显示音量数字
    badgeText = volume.toString();
  }
  
  // 保存状态
  badgeState.set(tabId, { volume, muted, isCapture, text: badgeText });
  
  // 设置角标（添加错误处理防止竞态条件）
  try {
    await chrome.action.setBadgeText({ tabId, text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
    await chrome.action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE });
  } catch {
    // 标签页可能在设置过程中被关闭，忽略错误
    badgeState.delete(tabId);
  }
});

// 清除角标 - 完整实现
router.on('BADGE_CLEAR', async (req, sender) => {
  const tabId = req.tabId ?? sender.tab?.id;
  if (!tabId) return;
  
  // 清除状态
  badgeState.delete(tabId);
  
  // 添加错误处理，防止标签页不存在时抛出错误
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {
    // 静默处理
  });
});

// 添加域名到用户注册表
router.on('REGISTRY_ADD_DOMAIN', async (req) => {
  const success = await storage.addToUserRegistry(req.domain);
  return { success, reason: success ? undefined : 'Already exists' };
});

// ============================================
// 快捷键处理
// ============================================

chrome.commands.onCommand.addListener(async (command) => {
  // 获取当前活动标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;
  
  let domain = '';
  try {
    domain = new URL(tab.url).hostname;
  } catch {
    return;
  }
  
  const config = await storage.getAudioConfig(domain);
  let newConfig: Partial<AudioConfig> = {};
  
  switch (command) {
    case 'volume_up':
      newConfig = { volume: Math.min(800, config.volume + 10) };
      break;
    case 'volume_down':
      newConfig = { volume: Math.max(0, config.volume - 10) };
      break;
    case 'toggle_mute':
      newConfig = { muted: !config.muted };
      break;
  }
  
  // 保存新配置
  await storage.setAudioConfig(domain, newConfig);
  
  // 通知 Content Script 更新
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'SHORTCUT_TRIGGER',
      payload: { command }
    });
  } catch {
    // Content Script 可能未加载
  }
});

// ============================================
// Tab 生命周期事件
// ============================================

/**
 * 内部 Capture 切换函数 (用于生命周期清理)
 */
async function handleCaptureToggle(tabId: number, enabled: boolean): Promise<void> {
  if (enabled) return; // 这里只处理停止
  
  if (!captureStates.get(tabId)) return;
  
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop', tabId }).catch(() => {});
  captureStates.set(tabId, false);
}

// 标签页更新事件 - 页面重载时清理
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // 页面重新加载时清除角标
    badgeState.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    
    // 如果有 Capture 活动，强制停止
    if (captureStates.get(tabId)) {
      console.log(`[SPECTRA] Tab ${tabId} reloading, force stopping capture.`);
      handleCaptureToggle(tabId, false);
    }
  }
});

// 标签页关闭事件 - 清理所有状态
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTabState(tabId);
  
  // 如果有 Capture 活动，停止
  if (captureStates.get(tabId)) {
    handleCaptureToggle(tabId, false);
  }
});

// ============================================
// 启动监听
// ============================================

router.listen();

console.log('[SPECTRA] Background Service Worker started.');

