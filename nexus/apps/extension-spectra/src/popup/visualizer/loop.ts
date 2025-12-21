/**
 * SPECTRA Popup - 可视化动画循环
 */

import type { GlobalSettings } from '@nexus/kernel';
import { TIMING } from '../constants';
import { sendToTab } from '../utils/dom';
import { drawViz } from './draw-viz';

/** 动画循环参数 */
export interface VizLoopParams {
  canvas: HTMLCanvasElement;
  tabId: number;
  getConfig: () => { enabled: boolean; muted: boolean };
  getCapturing: () => boolean;
  getGlobalSettings: () => GlobalSettings;
  /** 是否首次预测为 Capture (需要延迟启动) */
  initialPredictedCapture: boolean;
  /** 当前是否已激活 Capture */
  isCaptureActive: boolean;
}

/**
 * 创建可视化动画循环
 * 
 * @returns 启动函数
 */
export function createVizLoop(params: VizLoopParams): () => void {
  const {
    canvas,
    tabId,
    getConfig,
    getCapturing,
    getGlobalSettings,
    initialPredictedCapture,
    isCaptureActive,
  } = params;

  let isRequesting = false;
  let lastDraw = 0;
  let loopStarted = false;

  const loop = async (timestamp: number) => {
    // 帧率限制 (~30 FPS)
    if (timestamp - lastDraw < TIMING.VIZ_FRAME_INTERVAL) {
      requestAnimationFrame(loop);
      return;
    }
    lastDraw = timestamp;

    const config = getConfig();
    const gSettings = getGlobalSettings();

    if (config.enabled && !config.muted) {
      // 检查全局可视化开关
      if (gSettings.visualizerEnabled === false) {
        drawViz(canvas, null, true, getCapturing());
        requestAnimationFrame(loop);
        return;
      }

      if (!isRequesting) {
        isRequesting = true;
        let buffer: number[] | null = null;
        const currentCapturing = getCapturing();

        try {
          if (currentCapturing) {
            // 从 offscreen 获取 (Capture 模式)
            const res = await chrome.runtime.sendMessage({
              target: 'offscreen',
              action: 'getViz',
              tabId,
            }).catch(() => null);

            if (res?.buffer) {
              buffer = res.buffer;
            } else {
              // Fallback: 从 content.js 获取 (NEXUS 格式)
              const data = await sendToTab<{ buffer: number[] }>(tabId, 'AUDIO_GET_VISUALIZER', {});
              if (data?.buffer) buffer = data.buffer;
            }
          } else {
            // 从 content.js 获取 (Native 模式, NEXUS 格式)
            const data = await sendToTab<{ buffer: number[] }>(tabId, 'AUDIO_GET_VISUALIZER', {});
            if (data?.buffer) buffer = data.buffer;
          }
        } catch {
          // 静默失败
        }

        drawViz(canvas, buffer, false, currentCapturing);
        isRequesting = false;
      }
    } else {
      // 禁用或静音时清空
      drawViz(canvas, null, true, getCapturing());
    }

    requestAnimationFrame(loop);
  };

  // 启动函数
  const startLoop = () => {
    if (!loopStarted) {
      loopStarted = true;
      requestAnimationFrame(loop);
    }
  };

  // 返回启动函数 (可能需要延迟调用)
  return () => {
    // 如果是预测的 Capture 模式且尚未激活，延迟启动
    if (initialPredictedCapture && !isCaptureActive) {
      setTimeout(startLoop, TIMING.CAPTURE_INIT_DELAY);
    } else {
      startLoop();
    }
  };
}
