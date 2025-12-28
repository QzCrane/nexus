/**
 * SPECTRA Popup - Card State Management
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { CardInternalState } from './types';
import { sendToTab, sendToBackground } from '../utils/dom';

export function createGetCapturing(
  state: CardInternalState,
): () => boolean {
  return () => {
    return !!state.isCaptureActive;
  };
}

export function createUpdateFn(
  state: CardInternalState,
  tabId: number,
  _getCapturing: () => boolean,
  render: () => void,
  _getGlobalSettings: () => GlobalSettings
): (changes: Partial<AudioConfig>) => void {
  return async (changes: Partial<AudioConfig>) => {
    // Ignore simple enable/disable toggles for "Interacted" logic
    const isOperation = Object.keys(changes).some(k => k !== 'enabled');
    if (isOperation) {
      state.userInteracted = true;
    }

    // Optimistic update
    state.config = { ...state.config, ...changes };
    const config = state.config;

    // Capture Mode: Direct Sync to Offscreen
    if (state.isCaptureActive) {
      // 1. Direct to Offscreen
      sendToBackground('CAPTURE_UPDATE_CONFIG', { tabId, config });

      // 2. Notify Content Script (for badge/UI sync)
      sendToTab(tabId, 'AUDIO_SET_CONFIG', { config }).catch(() => { });

      // 3. Sync Badge
      state.userInteracted = true;

      sendToBackground('BADGE_UPDATE', {
        tabId,
        volume: config.volume,
        muted: config.muted,
        isCapture: true, // Always true for Capture mode
        userInteracted: state.userInteracted,
      });

      render();
      return;
    }

    // Native Mode: Delegate to Content Script
    const response = await sendToTab<{
      success: boolean;
      state: { mode: string; config: AudioConfig };
    }>(tabId, 'AUDIO_SET_CONFIG', { config });

    if (response?.success && response.state) {
      const suggestedMode = response.state.mode;
      const wasCapturing = state.isCaptureActive;
      const needsCapture = suggestedMode === 'CAPTURE';

      // Switch to Capture if suggested
      if (needsCapture && !wasCapturing) {
        state.isCaptureActive = true;
        state.actualMode = 'CAPTURE';
        sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
      }
      // Switch to Native if suggested
      else if (!needsCapture && wasCapturing) {
        state.isCaptureActive = false;
        state.actualMode = suggestedMode as any;
        sendToBackground('CAPTURE_TOGGLE', { enabled: false, config, tabId });
      }

      // Sync Badge
      if (needsCapture) {
        state.userInteracted = true;
      }

      sendToBackground('BADGE_UPDATE', {
        tabId,
        volume: config.volume,
        muted: config.muted,
        isCapture: needsCapture,
        userInteracted: state.userInteracted,
      });
    }

    render();
  };
}

