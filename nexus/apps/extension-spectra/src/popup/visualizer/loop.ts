// goal: samples visualizer data through one visibility-aware popup scheduler

import type { GlobalSettings } from '@nexus/kernel';
import { TIMING } from '../constants';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { drawViz } from './draw-viz';

export interface VizLoopParams {
  canvas: HTMLCanvasElement;
  tabId: number;
  getConfig: () => { enabled: boolean; muted: boolean };
  getCapturing: () => boolean;
  getGlobalSettings: () => GlobalSettings;
}

interface VizSubscription {
  params: VizLoopParams;
  active: boolean;
  visible: boolean;
  requesting: boolean;
  silent: boolean;
}

const subscriptions = new Set<VizSubscription>();
const subscriptionsByCanvas = new Map<Element, VizSubscription>();
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let frameId = 0;

const intersectionObserver = typeof IntersectionObserver === 'undefined'
  ? null
  : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const subscription = subscriptionsByCanvas.get(entry.target);
        if (subscription) subscription.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      }
      scheduleFrame();
    });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScheduledFrame();
  else scheduleFrame();
});

function stopScheduledFrame(): void {
  if (frameTimer) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
}

function hasVisibleSubscriptions(): boolean {
  for (const subscription of subscriptions) {
    if (subscription.active && subscription.visible) return true;
  }
  return false;
}

function scheduleFrame(): void {
  if (document.hidden || frameTimer || frameId || !hasVisibleSubscriptions()) return;
  frameTimer = setTimeout(() => {
    frameTimer = null;
    frameId = requestAnimationFrame(runFrame);
  }, TIMING.VIZ_FRAME_INTERVAL);
}

function runFrame(): void {
  frameId = 0;
  const ready: VizSubscription[] = [];
  for (const subscription of subscriptions) {
    if (!subscription.active || !subscription.visible || subscription.requesting) continue;
    const { params } = subscription;
    const config = params.getConfig();
    const settings = params.getGlobalSettings();
    if (!config.enabled || config.muted || settings.visualizerEnabled === false) {
      if (!subscription.silent) drawViz(params.canvas, null, true, params.getCapturing());
      subscription.silent = true;
      continue;
    }
    subscription.silent = false;
    subscription.requesting = true;
    ready.push(subscription);
  }
  if (ready.length > 0) void sampleBatch(ready);
  scheduleFrame();
}

async function sampleBatch(ready: VizSubscription[]): Promise<void> {
  try {
    const response = await sendSpectraRequest('spectra.audio.visualizer.batch', {
      tabIds: [...new Set(ready.map((subscription) => subscription.params.tabId))],
    });
    for (const subscription of ready) {
      const frame = response.ok
        ? (response.data.frames[String(subscription.params.tabId)] ?? null)
        : null;
      drawViz(
        subscription.params.canvas,
        frame,
        !frame,
        subscription.params.getCapturing(),
      );
    }
  } catch {
    for (const subscription of ready) {
      drawViz(subscription.params.canvas, null, true, subscription.params.getCapturing());
    }
  } finally {
    for (const subscription of ready) subscription.requesting = false;
    scheduleFrame();
  }
}

function register(params: VizLoopParams): () => void {
  const subscription: VizSubscription = {
    params,
    active: true,
	visible: !intersectionObserver,
    requesting: false,
    silent: false,
  };
  subscriptions.add(subscription);
  subscriptionsByCanvas.set(params.canvas, subscription);
  intersectionObserver?.observe(params.canvas);
  scheduleFrame();

  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
    subscriptionsByCanvas.delete(params.canvas);
    intersectionObserver?.unobserve(params.canvas);
    if (!hasVisibleSubscriptions()) stopScheduledFrame();
  };
}

// post: returns an idempotent start function; all cards share the same 15 Hz scheduler
export function createVizLoop(params: VizLoopParams): () => void {
  let cleanup: (() => void) | null = null;

  const start = () => {
    if (cleanup) return;
    cleanup = register(params);
    window.addEventListener('pagehide', () => cleanup?.(), { once: true });
  };

  return start;
}
