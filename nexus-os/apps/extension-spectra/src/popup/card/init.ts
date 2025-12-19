/**
 * SPECTRA Popup - initCard 主函数
 */

import type { GlobalSettings } from '@nexus/kernel';
import type { I18NDict, ContentStatusResponse } from '../types';
import { getDomain, sendToTab, sendToBackground, ensureInjected } from '../utils/dom';
import { getEffectiveRegistry, cardRenderCallbacks } from '../views/settings';
import { getCardUIElements } from './ui-elements';
import { cleanConfig, type CardInternalState } from './types';
import { createGetCapturing, createUpdateFn } from './state';
import { createRenderFn } from './render';
import { bindCardEvents } from './events';
import { setupCardMessaging } from './messaging';

/** initCard 参数 */
export interface InitCardParams {
  container: HTMLElement;
  template: HTMLTemplateElement;
  tab: chrome.tabs.Tab;
  dict: I18NDict;
  userRegistry: string[];
  getGlobalSettings: () => GlobalSettings;
  /** EQ 曲线绘制回调 (由 visualizer 模块提供) */
  createEqCurveDrawer?: (
    canvas: HTMLCanvasElement,
    sliderRow: HTMLElement,
    getEqValues: () => number[]
  ) => { draw: () => void; updateMetrics: () => void };
}

/**
 * 初始化单个音频卡片
 * @returns 是否成功创建卡片
 */
export async function initCard(params: InitCardParams): Promise<boolean> {
  const { container, template, tab, dict, userRegistry, getGlobalSettings, createEqCurveDrawer } = params;

  if (!tab.id) return false;
  const tabId = tab.id;

  // 确保 Content Script 已注入
  if (!await ensureInjected(tabId)) return false;

  // 获取标签页状态 (NEXUS 格式)
  const status = await sendToTab<ContentStatusResponse>(tabId, 'AUDIO_GET_STATUS', {});
  const isCaptureActive = await sendToBackground<boolean>('CAPTURE_GET_STATE', { tabId });

  // 判断是否有活跃媒体
  const hasActiveMedia = tab.audible || isCaptureActive || (status?.isPlaying);
  if (!hasActiveMedia) return false;

  // 克隆模板并添加到容器
  const card = template.content.cloneNode(true) as DocumentFragment;
  const cardEl = card.querySelector('.glass-card') as HTMLElement;
  if (!cardEl) return false;
  container.appendChild(cardEl);

  // 获取 UI 元素
  const ui = getCardUIElements(cardEl);
  const domain = getDomain(tab.url || '');

  // 初始化状态
  const effectiveRegistry = getEffectiveRegistry(userRegistry);
  const isRestrictedSite = effectiveRegistry.some(
    (d) => domain.includes(d) || d.includes(domain)
  );

  const state: CardInternalState = {
    config: status ? cleanConfig(status.config) : cleanConfig(null),
    isCaptureActive: !!isCaptureActive,
    userInteracted: status?.userInteracted ?? false,
    isRestrictedSite,
  };

  // 创建 Capture 判断函数
  const getCapturing = createGetCapturing(state, getGlobalSettings);

  // EQ 曲线绘制器 (如果提供)
  const sliderRow = cardEl.querySelector('.eq-sliders-row') as HTMLElement;
  const eqCanvas = cardEl.querySelector('.eq-curve-canvas') as HTMLCanvasElement;
  const eqDrawer = createEqCurveDrawer?.(eqCanvas, sliderRow, () => state.config.eqValues);
  const drawEqCurve = eqDrawer?.draw ?? (() => {});
  const updateMetrics = eqDrawer?.updateMetrics ?? (() => {});

  // 创建渲染函数
  const gSettings = getGlobalSettings();
  const render = createRenderFn({
    ui,
    state,
    getCapturing,
    drawEqCurve,
    vizEnabled: gSettings.visualizerEnabled !== false,
  });

  // 创建更新函数
  const update = createUpdateFn(state, tabId, getCapturing, render);

  // 设置初始 UI 文本
  ui.tComp.innerText = dict.comp;
  ui.tBass.innerText = dict.bass;
  ui.tMono.innerText = dict.mono;
  ui.tEq.innerText = dict.eqTitle;
  ui.btnSave.innerText = dict.save;
  ui.btnSave.title = dict.saveTooltip;
  ui.btnReset.innerText = dict.reset;
  ui.btnReset.title = dict.resetTooltip;
  ui.maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
  ui.title.innerText = tab.title || '';
  ui.title.title = tab.title || '';
  ui.domain.innerText = domain;
  ui.icon.src = tab.favIconUrl || 'icon.png';

  // 初始化可视化岛状态
  if (ui.vizIsland) {
    ui.vizIsland.classList.toggle('hidden', gSettings.visualizerEnabled === false);
  }

  // 绑定事件
  bindCardEvents({
    ui,
    state,
    tabId,
    tabUrl: tab.url || '',
    update,
    getCapturing,
    onMetricsUpdate: updateMetrics,
  });

  // 设置消息监听
  const cleanupMessaging = setupCardMessaging({ tabId, state, render });
  window.addEventListener('unload', cleanupMessaging);

  // 注册渲染回调
  cardRenderCallbacks.push(render);

  // 初始渲染
  render();

  // 启动可视化循环 (仅当 canvas 在文档中)
  if (document.body.contains(cardEl) && ui.canvas) {
    const { createVizLoop } = await import('../visualizer/loop');
    const startViz = createVizLoop({
      canvas: ui.canvas,
      tabId,
      getConfig: () => state.config,
      getCapturing,
      getGlobalSettings,
      initialPredictedCapture: state.isRestrictedSite && gSettings.visualizerEnabled !== false,
      isCaptureActive: state.isCaptureActive,
    });
    startViz();
  }

  return true;
}
