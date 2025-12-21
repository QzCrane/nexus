/**
 * SPECTRA Popup - 卡片状态管理
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { CardInternalState } from './types';
import { sendToTab, sendToBackground } from '../utils/dom';

/**
 * 创建 Capture 状态判断函数
 * 
 * 优先使用 state.isCaptureActive (来自 Background 的实测状态)
 */
export function createGetCapturing(
  state: CardInternalState,
): () => boolean {
  return () => {
    return !!state.isCaptureActive;
  };
}

/**
 * 创建配置更新函数 (NEXUS 架构)
 * 
 * 核心逻辑改进 (v24.1):
 * - Capture 模式：直接通过 CAPTURE_UPDATE_CONFIG 同步到 Offscreen，避免 Content Script 中转
 * - Native 模式：发送给 Content Script 处理
 */
export function createUpdateFn(
  state: CardInternalState,
  tabId: number,
  _getCapturing: () => boolean,
  render: () => void,
  _getGlobalSettings: () => GlobalSettings
): (changes: Partial<AudioConfig>) => void {
  return async (changes: Partial<AudioConfig>) => {
    // 标记用户已交互
    state.userInteracted = true;

    // 乐观更新：合并本地配置
    state.config = { ...state.config, ...changes };
    const config = state.config;

    // 🔴 关键改进：Capture 模式下直接同步到 Offscreen
    if (state.isCaptureActive) {
      // 1. 直接发送到 Offscreen (最短路径)
      sendToBackground('CAPTURE_UPDATE_CONFIG', { tabId, config });

      // 2. 同时通知 Content Script 更新本地状态 (用于角标和 UI 同步)
      sendToTab(tabId, 'AUDIO_SET_CONFIG', { config }).catch(() => { });

      // 3. 同步角标
      sendToBackground('BADGE_UPDATE', {
        tabId,
        volume: config.volume,
        muted: config.muted,
        isCapture: true,
      });

      render();
      return;
    }

    // Native 模式：发送给 Content Script 并获取策略建议
    const response = await sendToTab<{
      success: boolean;
      state: { mode: string; config: AudioConfig };
    }>(tabId, 'AUDIO_SET_CONFIG', { config });

    if (response?.success && response.state) {
      const suggestedMode = response.state.mode;
      const wasCapturing = state.isCaptureActive;
      const needsCapture = suggestedMode === 'CAPTURE';

      // 如果策略建议 CAPTURE，则触发 (利用当前用户手势)
      if (needsCapture && !wasCapturing) {
        state.isCaptureActive = true;
        state.actualMode = 'CAPTURE';
        sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
      }
      // 如果策略建议 NATIVE 但当前已激活，则停止
      else if (!needsCapture && wasCapturing) {
        state.isCaptureActive = false;
        state.actualMode = suggestedMode as any;
        sendToBackground('CAPTURE_TOGGLE', { enabled: false, config, tabId });
      }

      // 同步角标
      sendToBackground('BADGE_UPDATE', {
        tabId,
        volume: config.volume,
        muted: config.muted,
        isCapture: needsCapture,
      });
    }

    render();
  };
}

