/**
 * SPECTRA Popup - Card Messaging
 */

import type { AudioConfig } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';
import type { CardInternalState } from './types';

export interface MessagingParams {
  tabId: number;
  state: CardInternalState;
  render: () => void;
}

export function setupCardMessaging(params: MessagingParams): () => void {
  const { tabId, state, render } = params;

  const onMessageListener = (
    msg: { action: string; payload?: any; config?: AudioConfig; mode?: any; isCaptureActive?: boolean },
    sender: chrome.runtime.MessageSender
  ): boolean | undefined => {
    // Standard NEXUS msg format
    const action = msg.action;
    const payload = msg.payload || {};

    // 1. UI_SYNC: Sync from Content Script
    const isFromTargetTab = (sender.tab?.id === tabId) || (payload.tabId === tabId);
    if (action === Actions.UI_SYNC && isFromTargetTab) {
      const config = payload.config || msg.config;
      if (config) {
        // Clean temp fields
        const cleanedConfig = { ...config };
        delete (cleanedConfig as any).toggleMute;
        delete (cleanedConfig as any).volumeDelta;

        if (state.isDragging) {
          // Exclude volume/mute during drag
          const { volume, muted, ...otherConfig } = cleanedConfig;
          state.config = { ...state.config, ...otherConfig };
        } else {
          state.config = cleanedConfig;
        }
      }

      if (payload.mode || msg.mode) state.actualMode = (payload.mode || msg.mode);
      if (payload.isCaptureActive !== undefined) state.isCaptureActive = payload.isCaptureActive;
      else if (msg.isCaptureActive !== undefined) state.isCaptureActive = msg.isCaptureActive;

      // Sync Restricted state for visual consistency
      if (payload.isRestricted !== undefined) state.isRestrictedSite = payload.isRestricted;

      render();
    }

    // 2. CAPTURE_STATE_CHANGE: Background notification
    if (action === Actions.CAPTURE_STATE_CHANGE) {
      const msgTabId = payload.tabId ?? sender.tab?.id;
      if (msgTabId === tabId) {
        state.isCaptureActive = !!payload.enabled;
        if (state.isCaptureActive) {
          state.actualMode = 'CAPTURE';
        }
        render();
      }
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(onMessageListener);

  return () => {
    chrome.runtime.onMessage.removeListener(onMessageListener);
  };
}

export function connectToTab(tabId: number): chrome.runtime.Port | null {
  try {
    const port = chrome.tabs.connect(tabId, { name: 'popup-connection' });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
    });
    return port;
  } catch {
    return null;
  }
}
