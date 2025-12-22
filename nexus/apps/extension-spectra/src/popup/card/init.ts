/**
 * SPECTRA Popup - initCard 主函数
 */

import { predictCapture } from '@nexus/audio-engine';
import { getAudioConfig, type GlobalSettings } from '@nexus/kernel';
import type { I18NDict, ContentStatusResponse } from '../types';
import { getDomain, sendToTab, sendToBackground, ensureInjected } from '../utils/dom';
import { cardRenderCallbacks } from '../views/settings';
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

  // 1. 尝试获取状态，不再自动注入 (用户需刷新标签页以激活扩展)
  const status = await sendToTab<ContentStatusResponse>(tabId, 'AUDIO_GET_STATUS', {});
  if (!status) {
    // Content Script 未加载或上下文已失效，跳过此标签页
    return false;
  }

  const isCaptureActive = await sendToBackground<boolean>('CAPTURE_GET_STATE', { tabId });

  // 判断是否有活跃媒体
  const hasActiveMedia = tab.audible || isCaptureActive || (status?.isPlaying);
  if (!hasActiveMedia) return false;

  const domain = getDomain(tab.url || '');

  // 判断是否受限站点 (直接使用用户注册表)
  const isRestrictedSite = userRegistry.some(
    (d) => domain === d || domain.endsWith('.' + d)
  );

  // 🔴 优先从域名存储读取已保存配置 (实现刷新后沿用)
  const savedConfig = await getAudioConfig(domain);
  // 配置优先级：域名存储 > 默认值（默认100）
  const config = cleanConfig(savedConfig);

  const settings = getGlobalSettings();
  const predictedCapture = predictCapture({
    config,
    isRestricted: isRestrictedSite,
    visualizerEnabled: settings.visualizerEnabled,
  });

  // 优先使用 Background 返回的实际 Capture 状态，只有未获取到时才用预判
  const effectiveCaptureState = isCaptureActive ?? predictedCapture;

  const state: CardInternalState = {
    config,
    isCaptureActive: effectiveCaptureState,
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
    getGlobalSettings,
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

  // 🔴 Popup 打开触发策略：如果有频谱需求但 Capture 未激活，主动触发
  // 理由：打开 Popup 本身就是强用户手势，表达了增强意图
  console.log('[SPECTRA Popup] Capture 触发检测:', {
    visualizerEnabled: settings.visualizerEnabled,
    isRestrictedSite,
    isCaptureActive,
    domain,
    userRegistry,
  });
  if (settings.visualizerEnabled && isRestrictedSite && !isCaptureActive) {
    console.log('[SPECTRA Popup] 触发 Capture');
    sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
    state.isCaptureActive = true; // 乐观更新
    render(); // 重新渲染以更新颜色
  }

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
