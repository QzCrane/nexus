/**
 * SPECTRA Popup - initCard 主函数
 */

import { predictCapture } from '@nexus/audio-engine';
import { getAudioConfig, type GlobalSettings } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';
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
import { bindCardIconClick, registerCard } from '../side-panel';

/**
 * 初始化单个音频卡片
 * @returns 是否成功创建卡片
 */
export async function initCard(params: InitCardParams): Promise<boolean> {
  const { container, template, tab, dict, registryEntries, getGlobalSettings, createEqCurveDrawer } = params;

  if (!tab.id) return false;
  const tabId = tab.id;

  // 1. 尝试获取状态，不再自动注入 (用户需刷新标签页以激活扩展)
  const status = await sendToTab<ContentStatusResponse>(tabId, 'AUDIO_GET_STATUS', {});
  if (!status) {
    // Content Script 未加载或上下文已失效，跳过此标签页
    return false;
  }

  const isCaptureActive = await sendToBackground<boolean>('CAPTURE_GET_STATE', { tabId });

  // 检查当前标签页是否有遥控器连接
  let isRemoteActive = false;
  try {
    const remoteStatus = await chrome.runtime.sendMessage({
      action: Actions.REMOTE_GET_SESSION,
      tabId,
    });
    isRemoteActive = remoteStatus?.connected === true;
  } catch { /* 静默处理 */ }

  // 判断是否有活跃媒体
  const hasActiveMedia = tab.audible || isCaptureActive || (status?.isPlaying);

  // 遥控器连接时，跳过暂停保留判断，始终显示卡片
  if (!hasActiveMedia && !isRemoteActive) {
    // 检查暂停保留时间
    const pauseRetentionSeconds = getGlobalSettings().pauseRetentionSeconds ?? 60;
    if (pauseRetentionSeconds > 0 && status.pausedAt) {
      const pausedSeconds = (Date.now() - status.pausedAt) / 1000;
      if (pausedSeconds > pauseRetentionSeconds) {
        // 暂停时间超限，不显示卡片
        return false;
      }
    }
    // 暂停时间未超限或设置为永久保留，继续显示
  }

  const domain = getDomain(tab.url || '');

  // 判断是否受限站点 (初始值从注册表推断，后续由 UI_SYNC 消息实时同步)
  // 匹配逻辑：当前域名包含注册表条目，如 "www.douyin.com".includes("douyin.com")
  const isRestrictedSite = registryEntries.some(e =>
    e.restricted !== false && domain.includes(e.domain)
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

  // Capture 状态判断：实际状态 || 预判（预判用于首次打开 Popup 时触发）
  const effectiveCaptureState = isCaptureActive || predictedCapture;

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

  // 后台卡片：显示返回标签页按钮
  if (params.isBackground && ui.btnGotoTab) {
    ui.btnGotoTab.classList.remove('hidden');
  }

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

  // 绑定图标点击事件 (打开侧边面板)
  if (ui.icon) {
    bindCardIconClick(ui.icon, tabId, tab.title || '', tab.favIconUrl || '');
  }

  // 注册卡片信息供侧边面板使用
  registerCard(tabId, state.config, update, () => state.config);

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

  // 🔴 移除：Popup 打开不再自动触发劫持，遵循"开关 UI 不激活角标"规则
  /* 
  if (settings.visualizerEnabled && isRestrictedSite && !isCaptureActive) {
    sendToBackground('CAPTURE_TOGGLE', { enabled: true, config, tabId });
    state.isCaptureActive = true;
    render();
  }
  */

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
