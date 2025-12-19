/**
 * SPECTRA Popup - 卡片消息监听
 */

import type { AudioConfig } from '@nexus/kernel';
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
    msg: { action: string; config?: AudioConfig; tabId?: number; enabled?: boolean },
    sender: chrome.runtime.MessageSender
  ) => {
    // syncUI: 来自 Content Script 的配置同步 (如快捷键调节)
    if (msg.action === 'syncUI' && msg.config && sender.tab?.id === tabId) {
      state.config = msg.config;
      render();
    }

    // captureStateChange: Capture 状态变化
    if (msg.action === 'captureStateChange') {
      if (msg.tabId === tabId || sender.tab?.id === tabId) {
        state.isCaptureActive = !!msg.enabled;
        render();
      }
    }
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
