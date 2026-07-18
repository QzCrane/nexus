// goal: samples visualizer data through one visibility-aware popup scheduler

import type { GlobalSettings } from '@nexus/kernel';
import { TIMING } from '../constants';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { drawViz } from './draw-viz';
import { VISUALIZER_STATE_CHANGED_EVENT } from './events';

export interface VizLoopParams {
  canvas: HTMLCanvasElement;
  tabId: number;
  getConfig: () => { enabled: boolean; muted: boolean };
  getCapturing: () => boolean;
  isProcessorActive: () => boolean;
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
let announcedTabIds = '';
let batchInFlight = false;
let subscriberGeneration = 0;
const subscriberId = typeof crypto.randomUUID === 'function'
  ? `popup-${crypto.randomUUID()}`
  : `popup-${Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-')}`;

const intersectionObserver = typeof IntersectionObserver === 'undefined'
  ? null
  : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const subscription = subscriptionsByCanvas.get(entry.target);
        if (subscription) subscription.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      }
      reconcileScheduler();
    });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopScheduledFrame();
    releaseSubscriptions();
  }
  else reconcileScheduler();
});

document.addEventListener(VISUALIZER_STATE_CHANGED_EVENT, reconcileScheduler);

window.addEventListener('pagehide', releaseSubscriptions);

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

function isRunnable(subscription: VizSubscription): boolean {
  if (!subscription.active || !subscription.visible) return false;
  const config = subscription.params.getConfig();
  // rule: visualizer requires both audio enabled AND an active processor
  // to have meaningful frequency data to display
  return config.enabled
    && !config.muted
    && subscription.params.getGlobalSettings().visualizerEnabled !== false
    && subscription.params.isProcessorActive();
}

function hasRunnableSubscriptions(): boolean {
  for (const subscription of subscriptions) {
    if (isRunnable(subscription)) return true;
  }
  return false;
}

function reconcileScheduler(): void {
  if (document.hidden || !hasRunnableSubscriptions()) {
    stopScheduledFrame();
    releaseSubscriptions();
    return;
  }
  scheduleFrame();
}

function scheduleFrame(): void {
  if (document.hidden || frameTimer || frameId || !hasRunnableSubscriptions()) return;
  frameTimer = setTimeout(() => {
    frameTimer = null;
    frameId = requestAnimationFrame(runFrame);
  }, TIMING.VIZ_FRAME_INTERVAL);
}

function runFrame(): void {
  frameId = 0;
  // The in-flight request owns the next scheduling decision in its `finally`.
  // Do not wake a 15 Hz timer merely to discover that IPC is still pending.
  if (batchInFlight) return;
  const ready: VizSubscription[] = [];
  for (const subscription of subscriptions) {
    if (!subscription.active || !subscription.visible || subscription.requesting) continue;
    const { params } = subscription;
    if (!isRunnable(subscription)) {
      if (!subscription.silent) drawViz(params.canvas, null, true, params.getCapturing());
      subscription.silent = true;
      continue;
    }
    subscription.silent = false;
    subscription.requesting = true;
    ready.push(subscription);
  }
  if (ready.length > 0) {
    void sampleBatch(ready);
    return;
  }
  releaseSubscriptions();
}

async function sampleBatch(ready: VizSubscription[]): Promise<void> {
  const tabIds = [...new Set(ready.map((subscription) => subscription.params.tabId))];
  announcedTabIds = [...tabIds].sort((left, right) => left - right).join(',');
  const generation = ++subscriberGeneration;
  batchInFlight = true;
  try {
    const response = await sendSpectraRequest('spectra.audio.visualizer.batch', {
      subscriberId,
      generation,
      tabIds,
    });
    for (const subscription of ready) {
      const frame = response.ok
        && response.data.subscriberId === subscriberId
        && response.data.generation === generation
        && subscriberGeneration === generation
        && subscription.active
        && subscription.visible
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
    batchInFlight = false;
    reconcileScheduler();
  }
}

function releaseSubscriptions(): void {
  if (!announcedTabIds) return;
  announcedTabIds = '';
  const generation = ++subscriberGeneration;
  void sendSpectraRequest('spectra.audio.visualizer.batch', {
    subscriberId,
    generation,
    tabIds: [],
  }).catch(() => undefined);
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
  reconcileScheduler();

  return () => {
    subscription.active = false;
    subscriptions.delete(subscription);
    subscriptionsByCanvas.delete(params.canvas);
    intersectionObserver?.unobserve(params.canvas);
    reconcileScheduler();
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
