/**
 * SPECTRA Popup - 卡片渲染函数
 */

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, AUDIO_UI } from '../constants';

/** 渲染参数 */
export interface RenderParams {
  ui: CardUIElements;
  state: CardInternalState;
  getCapturing: () => boolean;
  drawEqCurve: () => void;
  vizEnabled: boolean;
}

/**
 * 创建卡片渲染函数
 */
export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, getCapturing, drawEqCurve, vizEnabled } = params;

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

    // 动态颜色 (根据 Capture 状态)
    const isCapturing = getCapturing();
    const isMutedOrZero = muted || config.volume === 0;

    if (isCapturing) {
      ui.fill.style.backgroundColor = isMutedOrZero ? COLORS.MUTED : COLORS.CAPTURE;
      ui.val.style.color = isMutedOrZero ? COLORS.MUTED : COLORS.CAPTURE;
    } else {
      ui.fill.style.backgroundColor = isMutedOrZero ? COLORS.MUTED : '';
      ui.val.style.color = isMutedOrZero ? COLORS.MUTED : '';
    }

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
        inp.value = String(config.eqValues[i]);
      }
      const v = config.eqValues[i];
      ui.eqVals[i].innerText = (v > 0 ? '+' : '') + v.toFixed(1);
      ui.eqVals[i].style.color = v === 0 ? COLORS.MUTED : COLORS.NATIVE;
    });

    // 绘制 EQ 曲线
    drawEqCurve();

    // 可视化岛显示状态
    if (ui.vizIsland) {
      ui.vizIsland.classList.toggle('hidden', !vizEnabled);
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
