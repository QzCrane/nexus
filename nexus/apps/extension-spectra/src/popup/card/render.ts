/**
 * SPECTRA Popup - 卡片渲染函数
 */

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, AUDIO_UI } from '../constants';
import type { GlobalSettings } from '@nexus/kernel';
import { predictCapture } from '@nexus/audio-engine';

/** 渲染参数 */
export interface RenderParams {
  ui: CardUIElements;
  state: CardInternalState;
  getCapturing: () => boolean;
  drawEqCurve: (color: string) => void;
  /** 动态获取频谱可视化是否启用 (每次渲染时调用) */
  getVizEnabled: () => boolean;
  /** 动态获取全局设置 */
  getGlobalSettings: () => GlobalSettings;
}

/**
 * 创建卡片渲染函数
 */
export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, getCapturing, drawEqCurve, getVizEnabled, getGlobalSettings } = params;

  return () => {
    if (!ui.card) return;

    const config = state.config;
    const disabled = !config.enabled;
    const muted = config.muted;

    // 卡片状态类
    ui.card.classList.toggle('disabled', disabled);
    ui.card.classList.toggle('muted', muted);

    // 暂停遮罩
    ui.mask.classList.toggle('hidden', !disabled);
    ui.enable.checked = config.enabled;

    // 音量滑块
    ui.slider.value = String(config.volume);
    ui.fill.style.width = `${(config.volume / AUDIO_UI.MAX_VOLUME) * 100}%`;
    ui.val.innerText = muted ? 'MUTE' : `${config.volume}%`;
    ui.mute.classList.toggle('active', muted);

    // 颜色判断：优先使用实际 Capture 状态，确保与可视化同步
    const actualCapturing = getCapturing();
    const settings = getGlobalSettings();
    // 预判用于：Capture 未激活时根据策略预判颜色（比如设置变更后尚未重新激活）
    const isPredictedCapture = !actualCapturing && predictCapture({
      config,
      isRestricted: state.isRestrictedSite,
      visualizerEnabled: settings.visualizerEnabled,
    });
    const isCapture = actualCapturing || isPredictedCapture;
    const isMutedOrZero = muted || config.volume === 0;

    // Capture 模式 = 紫色, Native 模式 = 蓝色, 静音 = 灰色
    let fillColor: string;
    if (isMutedOrZero) {
      fillColor = COLORS.MUTED;
    } else if (isCapture) {
      fillColor = COLORS.CAPTURE;
    } else {
      fillColor = COLORS.NATIVE;
    }

    ui.fill.style.backgroundColor = fillColor;
    ui.val.style.color = fillColor;
    // 同步滑块圆点边框颜色 (通过 CSS 变量)
    ui.slider.style.setProperty('--slider-accent', fillColor);

    // 音量图标 (3态: 静音/正常/增强)
    renderVolumeIcon(ui.mute, muted, config.volume);

    // 功能开关
    ui.comp.checked = config.compressor;
    ui.bass.checked = config.bass;
    ui.mono.checked = config.mono;

    // EQ 滑块
    ui.eqInputs.forEach((inp, i) => {
      // 避免用户拖动时抖动
      if (document.activeElement !== inp) {
        inp.value = String(config.eqValues?.[i] ?? 0);
      }
      const v = config.eqValues?.[i] ?? 0;
      const display = ui.eqVals?.[i];
      if (display) {
        display.innerText = (v > 0 ? '+' : '') + v.toFixed(1);
        display.style.color = v === 0 ? COLORS.MUTED : fillColor;
      }
    });

    // 绘制 EQ 曲线 (传入动态颜色)
    drawEqCurve(fillColor);

    // 可视化岛显示状态 (每次渲染时动态获取设置)
    if (ui.vizIsland) {
      ui.vizIsland.classList.toggle('hidden', !getVizEnabled());
    }
  };
}

/** 渲染音量图标 */
function renderVolumeIcon(muteBtn: HTMLElement, muted: boolean, volume: number): void {
  muteBtn.innerHTML = '';
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';

  if (muted || volume === 0) {
    iconSpan.innerText = '🔇';
    muteBtn.style.opacity = '0.7';
  } else {
    muteBtn.style.opacity = '1';
    iconSpan.innerText = volume > 100 ? '🚀' : '🔊';
  }

  muteBtn.appendChild(iconSpan);
}
