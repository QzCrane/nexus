// goal: defines messaging listeners for the tab card to handle state synchronization between the popup, background, and content scripts

import { isSpectraEventEnvelope } from '@nexus/contracts';
import type { CardInternalState } from './types';
import { applyLegacyCardMessage } from './legacy-message-adapter';

export interface MessagingParams {
  tabId: number;
  state: CardInternalState;
  render: () => void;
}

// post: returns a cleanup function that removes the chrome.runtime.onMessage listener
export function setupCardMessaging(params: MessagingParams): () => void {
  const { tabId, state, render } = params;

  const onMessageListener = (
	rawMessage: unknown,
    sender: chrome.runtime.MessageSender
  ): boolean | undefined => {
	if (isSpectraEventEnvelope(rawMessage) && rawMessage.type === 'spectra.audio.session.changed') {
		const snapshot = rawMessage.payload;
		if (snapshot.tabId === tabId) {
			if (state.isDragging) {
				const { volume: _volume, muted: _muted, ...otherConfig } = snapshot.actualConfig;
				state.config = { ...state.config, ...otherConfig };
			} else {
				state.config = snapshot.actualConfig;
			}
			state.actualMode = snapshot.actualMode;
			state.desiredMode = snapshot.desiredMode;
			state.phase = snapshot.phase;
			state.generation = snapshot.generation;
			state.lastError = snapshot.lastError;
			state.isCaptureActive = snapshot.actualMode === 'capture';
			render();
		}
		return false;
	}
	// Capture lifecycle events are compatibility notifications, not authoritative
	// UI state. The preceding session.changed snapshot is the only mode/phase source.
	if (isSpectraEventEnvelope(rawMessage) && rawMessage.type === 'spectra.audio.capture.changed') return false;
	applyLegacyCardMessage(rawMessage, sender, params);
    return false;
  };

  chrome.runtime.onMessage.addListener(onMessageListener);

  return () => {
    chrome.runtime.onMessage.removeListener(onMessageListener);
  };
}

// eff: attempts to establish a long-lived port connection to the content script for high-frequency signaling
export function connectToTab(tabId: number): chrome.runtime.Port | null {
  try {
    const port = chrome.tabs.connect(tabId, { name: 'popup-connection' });
    port.onDisconnect.addListener(() => {
      // note: swallow error to avoid console noise if tab is closed during connection
      void chrome.runtime.lastError;
    });
    return port;
  } catch {
    return null;
  }
}
