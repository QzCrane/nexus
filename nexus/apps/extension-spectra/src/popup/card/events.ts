/**
 * SPECTRA Popup - 卡片事件绑定
 */

import type { AudioConfig } from '@nexus/kernel';
import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { AUDIO_UI, TIMING } from '../constants';
import { getDomain, sendToBackground } from '../utils/dom';
import { DEFAULT_CONFIG } from './types';

/** 事件绑定参数 */
export interface EventsParams {
  ui: CardUIElements;
  state: CardInternalState;
  tabId: number;
  tabUrl: string;
  update: (changes: Partial<AudioConfig>) => void;
  getCapturing: () => boolean;
  onMetricsUpdate: () => void;
  render: () => void;
}

/**
 * 绑定卡片所有事件
 */
export function bindCardEvents(params: EventsParams): void {
  const { ui, state, tabId, tabUrl, update, getCapturing, onMetricsUpdate } = params;
  const domain = getDomain(tabUrl);

  // 启用/禁用开关
  ui.enable.onchange = (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    update({ enabled });

    // 禁用时关闭 Capture (NEXUS 格式)
    if (!enabled && getCapturing()) {
      state.isCaptureActive = false;
      sendToBackground('CAPTURE_TOGGLE', {
        enabled: false,
        config: state.config,
        tabId,
      });
    }
  };

  // 点击遮罩恢复
  ui.mask.onclick = () => update({ enabled: true });

  // 辅助：处理音量变更逻辑
  const handleVolume = (val: string | number) => {
    const v = typeof val === 'string' ? parseInt(val, 10) : val;
    update({ volume: v, muted: false });
  };

  // 音量滑块 - 基础事件
  ui.slider.oninput = (e) => {
    state.isDragging = true;
    handleVolume((e.target as HTMLInputElement).value);
  };

  // 音量滑块 - 结束交互时恢复同步
  const endDragging = () => {
    state.isDragging = false;
    // 立即手动触发一次渲染，确保如果在此期间收到了消息，能同步到最新且准确的状态
    params.render ? params.render() : null; // 注意：EventsParams 里没有 render，但可以通过 props 注入或使用 update 带来的 render
  };

  // 这里的 update 函数已经包含了渲染逻辑，所以只要停止 dragging 标记，下次 sync 就会生效
  ui.slider.onchange = () => {
    state.isDragging = false;
  };

  // 增加鼠标/触摸结束监听，更保险
  ui.slider.onmouseup = () => { state.isDragging = false; };
  ui.slider.ontouchend = () => { state.isDragging = false; };
  ui.slider.onmousedown = () => { state.isDragging = true; };
  ui.slider.ontouchstart = () => { state.isDragging = true; };

  // 滑块区域滚轮
  ui.sliderArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!state.config.enabled) return;

    let v = parseInt(ui.slider.value, 10);
    v = e.deltaY < 0
      ? Math.min(v + AUDIO_UI.VOLUME_STEP, AUDIO_UI.MAX_VOLUME)
      : Math.max(v - AUDIO_UI.VOLUME_STEP, 0);
    handleVolume(v);
  }, { passive: false });

  // 静音按钮
  ui.mute.onclick = () => update({ muted: !state.config.muted });

  // 功能开关
  ui.comp.onchange = (e) => update({ compressor: (e.target as HTMLInputElement).checked });
  ui.bass.onchange = (e) => update({ bass: (e.target as HTMLInputElement).checked });
  ui.mono.onchange = (e) => update({ mono: (e.target as HTMLInputElement).checked });

  // EQ 抽屉展开/收起
  ui.eqTrigger.onclick = () => {
    ui.eqDrawer.classList.toggle('open');
    const arrow = ui.eqTrigger.querySelector('.eq-arrow');
    if (arrow) {
      arrow.textContent = ui.eqDrawer.classList.contains('open') ? '▲' : '▼';
    }
    setTimeout(onMetricsUpdate, TIMING.EQ_DRAWER_DELAY);
  };

  // EQ 滑块
  ui.eqInputs.forEach((inp, i) => {
    inp.oninput = (e) => {
      const arr = [...state.config.eqValues];
      arr[i] = parseFloat((e.target as HTMLInputElement).value);
      update({ eqValues: arr });
    };

    // 滚轮调节
    inp.parentElement?.addEventListener('wheel', (e) => {
      e.preventDefault();
      let v = parseFloat(inp.value);
      v = e.deltaY < 0
        ? Math.min(v + AUDIO_UI.EQ_STEP, AUDIO_UI.EQ_MAX)
        : Math.max(v - AUDIO_UI.EQ_STEP, AUDIO_UI.EQ_MIN);
      v = Math.round(v * 10) / 10;

      const arr = [...state.config.eqValues];
      arr[i] = v;
      update({ eqValues: arr });
    }, { passive: false });
  });

  // 保存按钮
  ui.btnSave.onclick = () => {
    chrome.storage.local.get(['siteSettings'], (r) => {
      const s = (r.siteSettings as Record<string, AudioConfig>) || {};
      s[domain] = state.config;
      chrome.storage.local.set({ siteSettings: s }, () => {
        const old = ui.btnSave.innerText;
        ui.btnSave.innerText = 'OK';
        setTimeout(() => { ui.btnSave.innerText = old; }, TIMING.BUTTON_FEEDBACK_DURATION);
      });
    });
  };

  // 重置按钮
  ui.btnReset.onclick = () => update(DEFAULT_CONFIG);
}
