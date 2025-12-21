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
 * 核心逻辑：
 * 1. 发送配置给 Content Script。
 * 2. Content Script 计算新模式 (NATIVE/CAPTURE) 并返回。
 * 3. Popup 根据新模式决定是否触发/停止 Capture (由于此处有用户手势，触发极高概率成功)。
 */
export function createUpdateFn(
  state: CardInternalState,
  tabId: number,
  _getCapturing: () => boolean,
  render: () => void,
  _getGlobalSettings: () => GlobalSettings
): (changes: Partial<AudioConfig>) => void {
  return async (changes: Partial<AudioConfig>) => {
    // 标记用户已交互 (本地更新，Content 也会更新)
    state.userInteracted = true;

    // 乐观更新：合并本地配置以防渲染滞后
    state.config = { ...state.config, ...changes };
    const config = state.config;

    // 1. 同步到 Content Script 并获取最新策略状态
    const response = await sendToTab<{
      success: boolean;
      state: { mode: string; config: AudioConfig };
    }>(tabId, 'AUDIO_SET_CONFIG', { config });

    if (response?.success && response.state) {
      const suggestedMode = response.state.mode;
      const wasCapturing = state.isCaptureActive;
      const needsCapture = suggestedMode === 'CAPTURE';

      // 2. 如果策略建议 CAPTURE 但当前未激活，则触发 (关键：利用当前用户手势)
      if (needsCapture && !wasCapturing) {
        state.isCaptureActive = true;
        state.actualMode = 'CAPTURE';
        sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
      }
      // 3. 如果策略建议 NATIVE 但当前已激活，则停止
      else if (!needsCapture && wasCapturing) {
        state.isCaptureActive = false;
        state.actualMode = suggestedMode as any;
        sendToBackground('CAPTURE_TOGGLE', { enabled: false, config, tabId });
      }
      // 4. 如果都在 CAPTURE 中，同步配置给 Offscreen
      else if (needsCapture && wasCapturing) {
        sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
      }

      // 同步角标
      sendToBackground('BADGE_UPDATE', {
        tabId,
        volume: config.volume,
        muted: config.muted,
        isCapture: needsCapture,
      });
    }

    // 重新渲染
    render();
  };
}
