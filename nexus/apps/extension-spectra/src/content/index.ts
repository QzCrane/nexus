/**
 * SPECTRA - Content Script 入口
 *
 * 注入到网页中，负责:
 * 1. 使用 PolicyEngine 决定音频处理模式
 * 2. 使用 WebAudioController 处理音频
 * 3. 与 Background 通信同步状态
 * 
 * 策略文档见: docs/migration/fix-audiocontext-policy.md
 */

import { createMessenger, DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import { PolicyEngine, WebAudioController } from '@nexus/audio-engine';

// 模块化导入
import { isExtensionContextValid, safeSend } from './context-guard';
import { createSettingsManager } from './settings-manager';
import { createCaptureManager } from './capture-manager';
import { createPolicyExecutor, type PolicyExecutorState } from './policy-executor';
import { createMessageHandler } from './message-handler';
import { logger } from '../shared/logger';

// 生命周期模块
import {
  createMediaObserver,
  createStateReapplyInterval,
  createMediaReportInterval,
  reportMediaState,
  setupUserGestureListeners,
  setupPopupConnectionListener,
  cleanupIntervals,
} from './lifecycle';

const log = logger.content;

// ============================================
// 防止重复注入
// ============================================
if (
  (window as unknown as { __SPECTRA_INJECTED__?: boolean }).__SPECTRA_INJECTED__
) {
  log.debug('Already injected, skipping.');
} else {
  (
    window as unknown as { __SPECTRA_INJECTED__?: boolean }
  ).__SPECTRA_INJECTED__ = true;
  // E2E 测试标记
  document.documentElement.setAttribute('data-spectra-injected', 'true');
  initSpectra();
}

/**
 * SPECTRA 初始化主函数
 */
function initSpectra(): void {
  log.info('SPECTRA Initializing... v24.0.1');

  // ============ 创建核心组件 ============
  const messenger = createMessenger('content');
  const policyEngine = new PolicyEngine();
  const audioController = new WebAudioController();

  log.info('Core components created:', {
    hasMessenger: !!messenger,
    hasPolicyEngine: !!policyEngine,
    calculateModeType: typeof policyEngine.calculateMode,
    hasAudioController: !!audioController
  });

  // ============ 创建管理器 ============
  const settingsManager = createSettingsManager(messenger);
  const captureManager = createCaptureManager(messenger);

  // ============ 初始化状态 ============
  const state: PolicyExecutorState = {
    config: { ...DEFAULT_AUDIO_CONFIG },
    activeMode: null,
    userHasInteracted: false,
    isPopupOpen: false,
  };

  // ============ 设置监听器 ============
  setupPopupConnectionListener(state);

  // ============ 创建策略执行器 ============
  const policyExecutor = createPolicyExecutor(
    { messenger, policyEngine, audioController, captureManager, settingsManager },
    state
  );

  // ============ 创建消息处理器 ============
  const messageHandler = createMessageHandler({
    state,
    policyExecutor,
    captureManager,
    settingsManager,
    getVisualizerData: () => audioController.getVisualizerData(),
  });
  chrome.runtime.onMessage.addListener(messageHandler);

  // ============ 生命周期管理 ============
  let cleanupObserver: (() => void) | null = null;
  const intervals: { stateReapply?: ReturnType<typeof setInterval>; mediaReport?: ReturnType<typeof setInterval> } = {};

  // 上下文失效时的清理回调
  const handleContextInvalid = () => {
    cleanupIntervals(intervals);
    cleanupObserver?.();
    log.debug('Extension context invalidated, cleanup complete.');
  };

  // 媒体观察器
  cleanupObserver = createMediaObserver(state, audioController, policyExecutor);

  // 定时任务
  intervals.stateReapply = createStateReapplyInterval(state, policyExecutor, handleContextInvalid);
  intervals.mediaReport = createMediaReportInterval(messenger, handleContextInvalid);

  // 用户手势监听
  setupUserGestureListeners(state, audioController, policyExecutor);

  // ============ 初始化加载 ============
  loadConfigAndApply(messenger, state, settingsManager, policyExecutor);

  log.info('Content Script initialized.');
}

/**
 * 加载配置并应用
 */
async function loadConfigAndApply(
  messenger: ReturnType<typeof createMessenger>,
  state: PolicyExecutorState,
  settingsManager: ReturnType<typeof createSettingsManager>,
  policyExecutor: ReturnType<typeof createPolicyExecutor>
): Promise<void> {
  if (!isExtensionContextValid()) {
    log.debug('Extension context invalidated, skipping config load.');
    return;
  }

  try {
    // 加载音频配置
    const status = await safeSend(() => messenger.send('AUDIO_GET_STATUS'));
    if (status?.config) {
      state.config = status.config;
    }

    // 加载全局设置
    await settingsManager.load();

    // 上报媒体元素状态
    reportMediaState(messenger);

    // 应用状态
    policyExecutor.applyState();
  } catch {
    // Background 可能未准备好或上下文已失效
  }
}
