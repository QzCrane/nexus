/**
 * SPECTRA Popup - 卡片消息监听
 */

import type { AudioConfig } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';
import type { CardInternalState } from './types';

/** 消息监听参数 */
export interface MessagingParams {
  tabId: number;
  state: CardInternalState;
  render: () => void;
}

/**
 * 设置卡片消息监听
 * @returns 清理函数
 */
export function setupCardMessaging(params: MessagingParams): () => void {
  const { tabId, state, render } = params;

  const onMessageListener = (
    msg: { action: string; payload?: any; config?: AudioConfig; mode?: any; isCaptureActive?: boolean },
    sender: chrome.runtime.MessageSender
  ): boolean | undefined => {
    // 统一处理 NEXUS 格式消息 (通过 payload 传递)
    const action = msg.action;
    const payload = msg.payload || {};

    // 1. UI_SYNC: 来自 Content Script 的配置同步
    const isFromTargetTab = (sender.tab?.id === tabId) || (payload.tabId === tabId);
    if (action === Actions.UI_SYNC && isFromTargetTab) {
      const config = payload.config || msg.config;
      if (config) {
        if (state.isDragging) {
          const { volume, ...otherConfig } = config;
          state.config = { ...state.config, ...otherConfig };
        } else {
          state.config = config;
        }
      }

      if (payload.mode || msg.mode) state.actualMode = (payload.mode || msg.mode);
      if (payload.isCaptureActive !== undefined) state.isCaptureActive = payload.isCaptureActive;
      else if (msg.isCaptureActive !== undefined) state.isCaptureActive = msg.isCaptureActive;

      // 🔴 新增：同步受限状态，确保 UI 颜色与角标一致
      if (payload.isRestricted !== undefined) state.isRestrictedSite = payload.isRestricted;

      render();
    }

    // 2. CAPTURE_STATE_CHANGE: Capture 状态变化 (严格匹配 tabId)
    if (action === Actions.CAPTURE_STATE_CHANGE) {
      const msgTabId = payload.tabId ?? sender.tab?.id;
      if (msgTabId === tabId) {
        state.isCaptureActive = !!payload.enabled;
        // 同步更新 actualMode，如果是劫持则强制为 CAPTURE
        if (state.isCaptureActive) {
          state.actualMode = 'CAPTURE';
        }
        render();
      }
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(onMessageListener);

  // 返回清理函数
  return () => {
    chrome.runtime.onMessage.removeListener(onMessageListener);
  };
}

/**
 * 尝试建立与标签页的连接
 * @returns Port 或 null
 */
export function connectToTab(tabId: number): chrome.runtime.Port | null {
  try {
    const port = chrome.tabs.connect(tabId, { name: 'popup-connection' });
    port.onDisconnect.addListener(() => {
      // 必须检查 lastError 以阻止错误抛出
      void chrome.runtime.lastError;
    });
    return port;
  } catch {
    return null;
  }
}
