/**
 * SPECTRA Popup - 卡片状态管理
 */

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { CardInternalState } from './types';
import { sendToTab, sendToBackground } from '../utils/dom';

/**
 * 创建 Capture 状态判断函数
 * 
 * 动态计算当前是否处于 Capture 模式
 * 根据懒惰劫持策略：用户未交互 + 音量=100% -> NATIVE 模式
 */
export function createGetCapturing(
  state: CardInternalState,
  getGlobalSettings: () => GlobalSettings
): () => boolean {
  return () => {
    const config = state.config;
    
    // 懒惰劫持：用户未交互且音量=100%且未静音 -> NATIVE 模式
    if (!state.userInteracted && config.volume === 100 && !config.muted) {
      return false;
    }

    const gSettings = getGlobalSettings();
    const vizOn = gSettings.visualizerEnabled !== false;

    // 受限站点策略：
    // - 频谱开启 -> 必定 CAPTURE
    // - 频谱关闭 + 音量 > 100 -> CAPTURE
    // - 频谱关闭 + 音量 <= 100 -> NATIVE
    const predictedCapture = state.isRestrictedSite && (vizOn || config.volume > 100);
    
    return state.isCaptureActive || predictedCapture;
  };
}

/**
 * 创建配置更新函数 (使用 NEXUS Messenger)
 */
export function createUpdateFn(
  state: CardInternalState,
  tabId: number,
  getCapturing: () => boolean,
  render: () => void
): (changes: Partial<AudioConfig>) => void {
  return (changes: Partial<AudioConfig>) => {
    // 标记用户已交互
    state.userInteracted = true;
    
    // 合并配置
    state.config = { ...state.config, ...changes };
    
    const config = state.config;
    const isCapturing = getCapturing();

    // 发送配置更新到 Content Script (NEXUS 格式)
    sendToTab(tabId, 'AUDIO_SET_CONFIG', { config });

    // 更新角标 (NEXUS 格式)
    sendToBackground('BADGE_UPDATE', {
      tabId,
      volume: config.volume,
      muted: config.muted,
      isCapture: isCapturing,
    });

    // 重新渲染
    render();
  };
}
