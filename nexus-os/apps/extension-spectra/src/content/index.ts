/**
 * SPECTRA - Content Script
 *
 * 注入到网页中，负责:
 * 1. 使用 PolicyEngine 决定音频处理模式
 * 2. 使用 WebAudioController 处理音频
 * 3. 与 Background 通信同步状态
 */

import {
  createMessenger,
  type AudioConfig,
  DEFAULT_AUDIO_CONFIG,
} from "@nexus/kernel";
import {
  PolicyEngine,
  WebAudioController,
  AudioMode,
  type PolicyContext,
  type UrlInfo,
} from "@nexus/audio-engine";

// ============================================
// 防止重复注入
// ============================================
if (
  (window as unknown as { __SPECTRA_INJECTED__?: boolean }).__SPECTRA_INJECTED__
) {
  console.log("[SPECTRA] Already injected, skipping.");
} else {
  (
    window as unknown as { __SPECTRA_INJECTED__?: boolean }
  ).__SPECTRA_INJECTED__ = true;
  initSpectra();
}

function initSpectra() {
  // ============================================
  // 初始化
  // ============================================

  const messenger = createMessenger("content");
  const policyEngine = new PolicyEngine();
  const audioController = new WebAudioController();

  // 状态
  let config: AudioConfig = { ...DEFAULT_AUDIO_CONFIG };
  let activeMode: string | null = null;
  let userHasInteracted = false;
  let isCaptureActive = false;

  // ============================================
  // 获取当前 URL 信息
  // ============================================

  function getUrlInfo(): UrlInfo {
    return {
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    };
  }

  // ============================================
  // 策略计算与模式切换
  // ============================================

  function applyState() {
    const context: PolicyContext = {
      enabled: config.enabled,
      volume: config.volume,
      visualizerEnabled: true, // TODO: 从全局设置获取
      userHasInteracted,
    };

    const desiredMode = policyEngine.calculateDesiredMode(
      getUrlInfo(),
      context
    );

    if (desiredMode !== activeMode) {
      console.log(`[SPECTRA] Mode: ${activeMode} -> ${desiredMode}`);

      // 清理旧模式
      if (activeMode === AudioMode.NATIVE_WEBAUDIO) {
        audioController.cleanup();
      }
      if (
        activeMode === AudioMode.CAPTURE &&
        desiredMode !== AudioMode.CAPTURE
      ) {
        requestCapture(false);
      }

      activeMode = desiredMode;
    }

    // 执行当前模式
    if (activeMode === AudioMode.CAPTURE) {
      if (!isCaptureActive) {
        requestCapture(true);
      }
      // Capture 模式：DOM 音量设为 1，实际音量由 Offscreen 控制
      setDomVolume(1, false);
    } else if (activeMode === AudioMode.NATIVE_LITE) {
      // 精简模式：仅 DOM 控制
      const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
      setDomVolume(domVol, config.muted);
    } else if (activeMode === AudioMode.NATIVE_WEBAUDIO) {
      // WebAudio 模式
      if (!audioController.isReady()) {
        audioController.initialize();
      }
      audioController.scanAndAttach();
      audioController.updateParams(config);
    }
  }

  // ============================================
  // DOM 音量控制
  // ============================================

  function setDomVolume(volume: number, muted: boolean) {
    document.querySelectorAll("video, audio").forEach((el) => {
      const media = el as HTMLMediaElement;
      if (Math.abs(media.volume - volume) > 0.01) {
        media.volume = volume;
      }
      if (media.muted !== muted) {
        media.muted = muted;
      }
    });
  }

  // ============================================
  // Capture 请求
  // ============================================

  let isPendingCapture = false;

  function requestCapture(enabled: boolean) {
    if (isPendingCapture) return;
    isPendingCapture = true;

    messenger
      .send("CAPTURE_TOGGLE", { enabled, config })
      .then(() => {
        isCaptureActive = enabled;
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          isPendingCapture = false;
        }, 500);
      });
  }

  // ============================================
  // 消息监听
  // ============================================

  chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (!message?.action) return false;

    switch (message.action) {
      case "AUDIO_SET_CONFIG":
        config = { ...config, ...message.payload.config };
        userHasInteracted = true;
        applyState();
        updateBadge();
        sendResponse({ success: true });
        break;

      case "AUDIO_GET_STATUS":
        sendResponse({
          config,
          hasAudio: document.querySelectorAll("video, audio").length > 0,
          isPlaying: !!document.querySelector(
            "video:not([paused]), audio:not([paused])"
          ),
          mode: activeMode,
          userInteracted: userHasInteracted,
        });
        break;

      case "AUDIO_GET_VISUALIZER":
        sendResponse({ buffer: audioController.getVisualizerData() });
        break;

      case "SHORTCUT_TRIGGER":
        userHasInteracted = true;
        // 重新加载配置并应用
        loadConfigAndApply();
        sendResponse({});
        break;

      case "CAPTURE_STATE_CHANGE":
        isCaptureActive = message.payload.enabled;
        applyState();
        sendResponse({});
        break;
    }

    return true; // 异步响应
  });

  // ============================================
  // 角标更新
  // ============================================

  function updateBadge() {
    messenger
      .send("BADGE_UPDATE", {
        volume: config.volume,
        muted: config.muted,
        isCapture: activeMode === AudioMode.CAPTURE,
      })
      .catch(() => {});
  }

  // ============================================
  // 初始化加载
  // ============================================

  async function loadConfigAndApply() {
    try {
      const status = await messenger.send("AUDIO_GET_STATUS");
      config = status.config;
      applyState();
    } catch {
      // Background 可能未准备好
    }
  }

  // ============================================
  // 媒体元素监听
  // ============================================

  const observer = new MutationObserver(() => {
    if (activeMode === AudioMode.NATIVE_WEBAUDIO) {
      audioController.scanAndAttach();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ============================================
  // 启动
  // ============================================

  // CORS 检测回调
  audioController.setCorsDetectedCallback((hostname) => {
    messenger.send("REGISTRY_ADD_DOMAIN", { domain: hostname }).catch(() => {});
    applyState(); // 重新计算模式
  });

  // 初始化
  loadConfigAndApply();

  console.log("[SPECTRA] Content Script initialized.");
}
