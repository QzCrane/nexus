/**
 * SPECTRA Popup - initCard 主函数
 */

import { DefaultSiteRules } from '@nexus/audio-engine';
import type { GlobalSettings } from '@nexus/kernel';
import type { I18NDict, ContentStatusResponse } from '../types';
import { getDomain, sendToTab, sendToBackground, ensureInjected } from '../utils/dom';
import { getEffectiveRegistry, cardRenderCallbacks } from '../views/settings';
import { getCardUIElements } from './ui-elements';
import { cleanConfig, type CardInternalState, type InitCardParams } from './types';
import { createGetCapturing, createUpdateFn } from './state';
import { createRenderFn } from './render';
import { bindCardEvents } from './events';
import { setupCardMessaging } from './messaging';
import { prepareCardDom } from './dom-init';

/**
 * 初始化单个音频卡片
 * @returns 是否成功创建卡片
 */
export async function initCard(params: InitCardParams): Promise<boolean> {
  const { container, template, tab, dict, userRegistry, getGlobalSettings, createEqCurveDrawer } = params;

  if (!tab.id) return false;
  const tabId = tab.id;

  // 1. 尝试获取状态，如果获取不到再尝试注入 (优化性能，避免重复注入导致卡顿)
  let status = await sendToTab<ContentStatusResponse>(tabId, 'AUDIO_GET_STATUS', {});
  if (!status) {
    if (!await ensureInjected(tabId)) return false;
    // 注入后再次尝试获取
    status = await sendToTab<ContentStatusResponse>(tabId, 'AUDIO_GET_STATUS', {});
  }

  const isCaptureActive = await sendToBackground<boolean>('CAPTURE_GET_STATE', { tabId });

  // 判断是否有活跃媒体
  const hasActiveMedia = tab.audible || isCaptureActive || (status?.isPlaying);
  if (!hasActiveMedia) return false;

  const domain = getDomain(tab.url || '');
  const effectiveRegistry = getEffectiveRegistry(userRegistry);

  // 关键：排除已知原生支持的站点 (确保 B 站永远不会在初次加载时被判受限)
  const isWellKnownSite = DefaultSiteRules.some(r => domain.includes(r.hostPattern));
  const isRestrictedSite = !isWellKnownSite && effectiveRegistry.some(
    (d) => domain === d || domain.endsWith('.' + d)
  );

  const state: CardInternalState = {
    config: status ? cleanConfig(status.config) : cleanConfig(null),
    isCaptureActive: !!isCaptureActive,
    userInteracted: status?.userInteracted ?? false,
    isRestrictedSite,
    actualMode: status?.mode ?? null,
    isDragging: false,
  };

  // 准备 DOM 并设置文本 (现在返回正确的 ui 引用)
  const { ui, cardEl } = prepareCardDom({ template, container, tab, dict });

  // 创建 Capture 判断函数
  const getCapturing = createGetCapturing(state);

  // EQ 曲线绘制器 (如果提供)
  const sliderRow = cardEl.querySelector('.eq-sliders-row') as HTMLElement;
  const eqCanvas = cardEl.querySelector('.eq-curve-canvas') as HTMLCanvasElement;
  const eqDrawer = createEqCurveDrawer?.(eqCanvas, sliderRow, () => state.config.eqValues);
  const drawEqCurve = (color: string) => eqDrawer?.draw(color);
  const updateMetrics = eqDrawer?.updateMetrics ?? (() => { });

  // 创建渲染函数 (getVizEnabled 每次渲染时动态获取，确保设置变更后立即生效)
  const render = createRenderFn({
    ui,
    state,
    getCapturing,
    drawEqCurve,
    getVizEnabled: () => getGlobalSettings().visualizerEnabled !== false,
  });

  // 创建更新函数
  const update = createUpdateFn(state, tabId, getCapturing, render, getGlobalSettings);

  // 初始化可视化岛状态
  if (ui.vizIsland) {
    ui.vizIsland.classList.toggle('hidden', getGlobalSettings().visualizerEnabled === false);
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
    render,
  });

  // 设置消息监听
  const cleanupMessaging = setupCardMessaging({ tabId, state, render });
  window.addEventListener('unload', cleanupMessaging);

  // 注册渲染回调
  cardRenderCallbacks.push(() => {
    // 渲染 UI
    render();
  });

  // 初始渲染
  render();

  // 启动可视化循环 (仅当 canvas 在文档中)
  if (ui.canvas) {
    const { createVizLoop } = await import('../visualizer/loop');
    const startViz = createVizLoop({
      canvas: ui.canvas,
      tabId,
      getConfig: () => state.config,
      getCapturing,
      getGlobalSettings,
      initialPredictedCapture: state.isRestrictedSite && getGlobalSettings().visualizerEnabled !== false,
      isCaptureActive: state.isCaptureActive,
    });
    startViz();
  }

  return true;
}
