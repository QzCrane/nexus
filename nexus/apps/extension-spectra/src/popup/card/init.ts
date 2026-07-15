// goal: main entry point for initializing a tab control card, aggregating status probing, DOM setup, and event binding

import { DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import {
  hostnameMatchesRule,
  type AudioSessionSnapshot,
} from '@nexus/contracts';
import { getDomain } from '../utils/dom';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/spectra-client';
import { cardRenderCallbacks } from '../views/settings';
import { cleanConfig, type CardInternalState, type InitCardParams } from './types';
import { createGetCapturing, createUpdateFn } from './state';
import { createRenderFn } from './render';
import { bindCardEvents } from './events';
import { setupCardMessaging } from './messaging';
import { prepareCardDom } from './dom-init';
import { bindCardIconClick, registerCard } from '../side-panel';

// post: returns true if card was successfully initialized and appended to the container; false if the tab is non-responsive or should be skipped
export async function initCard(params: InitCardParams): Promise<boolean> {
  const { container, template, tab, dict, registryEntries, getGlobalSettings, createEqCurveDrawer } = params;

  if (!tab.id) return false;
  const tabId = tab.id;

  // rule: status reads are side-effect free; an unreachable document is omitted
  // until navigation or an explicit user operation installs the content runtime.
  const getRuntimeStatus = async () => {
    try {
      const result = await sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {});
      return result.ok ? result.data : null;
    } catch {
      return null;
    }
  };

  const status = await getRuntimeStatus();
  if (!status) return false;

  let acknowledgedSession: AudioSessionSnapshot | null = null;
  try {
    const response = await sendSpectraRequest(
      'spectra.audio.session.get',
      { tabId },
      { tabId },
    );
    if (response.ok) acknowledgedSession = response.data;
  } catch { /* session reads stay side-effect free while the worker restarts */ }

  const isCaptureActive = acknowledgedSession
    ? acknowledgedSession.actualMode === 'capture'
    : status.actualMode === 'capture';

  let isRemoteActive = false;
  try {
    const remoteStatus = await sendSpectraRequest(
      'spectra.remote.session.get',
      { tabId },
      { tabId },
    );
    isRemoteActive = remoteStatus.ok && remoteStatus.data.connected;
  } catch { /* silent fail */ }

  const hasActiveMedia = tab.audible || isCaptureActive || status.isPlaying;

  // rule: retention logic ensures a card stays visible for a grace period after audio stops, allowing the user to resume control
  if (!hasActiveMedia && !isRemoteActive) {
    const pauseRetentionSeconds = getGlobalSettings().pauseRetentionSeconds ?? 60;
    if (pauseRetentionSeconds > 0 && status.pausedAt) {
      const pausedSeconds = (Date.now() - status.pausedAt) / 1000;
      if (pausedSeconds > pauseRetentionSeconds) {
        return false;
      }
    }
  }

  const domain = getDomain(tab.url || '');

  const isRestrictedSite = registryEntries.some(e =>
    e.restricted !== false && hostnameMatchesRule(domain, e.domain)
  );

  // note: priority is Content Script runtime state > Saved Profile; cleanConfig ensures schema compliance
  // rule: status.config reflects current session state (may differ from saved preset)
  const runtimeConfig = acknowledgedSession?.actualConfig ?? status.config;
  const savedConfig = runtimeConfig ?? DEFAULT_AUDIO_CONFIG;
  const config = cleanConfig(savedConfig);

  const state: CardInternalState = {
    config,
    isCaptureActive,
    userInteracted: status.userInteracted,
    isRestrictedSite,
    actualMode: acknowledgedSession?.actualMode ?? status.actualMode,
    desiredMode: acknowledgedSession?.desiredMode ?? status.desiredMode,
    phase: acknowledgedSession?.phase ?? status.phase,
    generation: acknowledgedSession?.generation ?? status.generation,
    lastError: acknowledgedSession?.lastError ?? status.lastError,
    isDragging: false,
  };

  const { ui, cardEl } = prepareCardDom({ template, container, tab, dict });

  if (params.isBackground && ui.btnGotoTab) {
    ui.btnGotoTab.classList.remove('hidden');
  }

  const getCapturing = createGetCapturing(state);

  const sliderRow = cardEl.querySelector('.eq-sliders-row') as HTMLElement;
  const eqCanvas = cardEl.querySelector('.eq-curve-canvas') as HTMLCanvasElement;
  const eqDrawer = createEqCurveDrawer?.(eqCanvas, sliderRow, () => state.config.eqValues);
  const drawEqCurve = (color: string) => eqDrawer?.draw(color);
  const updateMetrics = eqDrawer?.updateMetrics ?? (() => { });

  const render = createRenderFn({
    ui,
    state,
    getCapturing,
    drawEqCurve,
    getVizEnabled: () => getGlobalSettings().visualizerEnabled !== false,
    getGlobalSettings,
  });

  const update = createUpdateFn(state, tabId, getCapturing, render, getGlobalSettings);

  if (ui.vizIsland) {
    ui.vizIsland.classList.toggle('hidden', getGlobalSettings().visualizerEnabled === false);
  }

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

  if (ui.icon) {
    bindCardIconClick(ui.icon, tabId, tab.title || '', tab.favIconUrl || '');
  }

  // note: register the update handle globally so settings can trigger re-renders from the Settings view
  registerCard(tabId, state.config, update, () => state.config);

  const cleanupMessaging = setupCardMessaging({ tabId, state, render });
  window.addEventListener('unload', cleanupMessaging);

  cardRenderCallbacks.push(() => {
    render();
  });

  render();

  // goal: dynamically import the visualizer loop to optimize initial popup load time
  if (ui.canvas) {
    const { createVizLoop } = await import('../visualizer/loop');
    const startViz = createVizLoop({
      canvas: ui.canvas,
      tabId,
      getConfig: () => state.config,
      getCapturing,
      getGlobalSettings,
    });
    startViz();
  }

  return true;
}
