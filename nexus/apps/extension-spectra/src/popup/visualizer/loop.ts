/**
 * SPECTRA Popup - Viz Loop
 */

import type { GlobalSettings } from '@nexus/kernel';
import { OffscreenActions } from '@nexus/contracts';
import { TIMING } from '../constants';
import { sendToTab } from '../utils/dom';
import { drawViz } from './draw-viz';

export interface VizLoopParams {
  canvas: HTMLCanvasElement;
  tabId: number;
  getConfig: () => { enabled: boolean; muted: boolean };
  getCapturing: () => boolean;
  getGlobalSettings: () => GlobalSettings;
  /** Whether initially predicted as Capture (needs delay start) */
  initialPredictedCapture: boolean;
  /** Whether Capture is active */
  isCaptureActive: boolean;
}

/**
 * Creates visualization loop
 * 
 * @returns Start function
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
    // Frame rate limit (~30 FPS)
    if (timestamp - lastDraw < TIMING.VIZ_FRAME_INTERVAL) {
      requestAnimationFrame(loop);
      return;
    }
    lastDraw = timestamp;

    const config = getConfig();
    const gSettings = getGlobalSettings();

    if (config.enabled && !config.muted) {
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
            // mode: Capture -> Offscreen
            const res = await chrome.runtime.sendMessage({
              target: 'offscreen',
              action: OffscreenActions.OFFSCREEN_GET_VIZ,
              tabId,
            }).catch(() => null);

            if (res?.buffer) {
              buffer = res.buffer;
            } else {
              // Fallback: Content (NEXUS format)
              const data = await sendToTab<{ buffer: number[] }>(tabId, 'AUDIO_GET_VISUALIZER', {});
              if (data?.buffer) buffer = data.buffer;
            }
          } else {
            // mode: Native -> Content
            const data = await sendToTab<{ buffer: number[] }>(tabId, 'AUDIO_GET_VISUALIZER', {});
            if (data?.buffer) buffer = data.buffer;
          }
        } catch {
          // silent fail
        }

        drawViz(canvas, buffer, false, currentCapturing);
        isRequesting = false;
      }
    } else {
      drawViz(canvas, null, true, getCapturing());
    }

    requestAnimationFrame(loop);
  };

  const startLoop = () => {
    if (!loopStarted) {
      loopStarted = true;
      requestAnimationFrame(loop);
    }
  };

  return () => {
    if (initialPredictedCapture && !isCaptureActive) {
      setTimeout(startLoop, TIMING.CAPTURE_INIT_DELAY);
    } else {
      startLoop();
    }
  };
}
