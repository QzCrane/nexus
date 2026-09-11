// goal: main entry point for initializing a tab control card, aggregating status probing, DOM setup, and event binding

import {
	audioSessionMatchesControlDocument,
	isActiveCaptureLifecycle,
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { isSpectraUiResponse } from '@nexus/contracts/ui-runtime';
import { RUNTIME_OBSERVATION_PORT } from '../../shared/runtime-observation';
import { readCardSnapshot } from './snapshot';
import { isCurrentTopDocument } from '../../shared/top-document';
import { registerCardRenderCallback } from '../views/settings';
import { VISUALIZER_STATE_CHANGED_EVENT } from '../visualizer/events';
import {
	initialControlConfig,
  mergeAudioConfig,
  type CardInternalState,
  type InitCardParams,
  type PopupVisualizerFactories,
} from './types';
import { createGetCapturing, createUpdateFn } from './state';
import { createRenderFn } from './render';
import { bindCardEvents } from './events';
import { setupCardMessaging } from './messaging';
import { reportCardControlFailure } from './error';
import { showPopupToast } from '../toast';
import { prepareCardDom } from './dom-init';
import { bindCardIconClick, getCurrentPanelTabId, registerCard } from '../side-panel';
import { syncSidePanelState } from '../side-panel/controls';
import { setPresetApplyTargetProvider } from '../views/preset-target';
import { getDomain } from '../utils/dom';

let popupClosing = false;
window.addEventListener('pagehide', () => { popupClosing = true; }, { once: true });

function observePopupTab(tabId: number, documentId: string): () => void {
  const port = chrome.runtime.connect(chrome.runtime.id, { name: RUNTIME_OBSERVATION_PORT });
  let closed = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(deadline);
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
    port.disconnect();
  };
  const onDisconnect = (): void => { dispose(); };
  const onMessage = (response: unknown): void => {
    clearTimeout(deadline);
    if (!isSpectraUiResponse('spectra.content.runtime.ensure', response) || !response.ok) {
      console.warn('[SPECTRA Popup] Runtime observation was not admitted');
      dispose();
    }
  };
  const deadline = setTimeout(dispose, 15_000);
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  port.postMessage({
    protocolVersion: SPECTRA_PROTOCOL_VERSION, requestId: crypto.randomUUID(),
    type: 'spectra.content.runtime.ensure', payload: { tabId, documentId, reason: 'observation' },
  });
  return dispose;
}

// post: returns true if card was successfully initialized and appended to the container; false if the tab is non-responsive or should be skipped
export async function initCard(params: InitCardParams): Promise<boolean> {
  const {
    container,
    template,
    tab,
    dict: initialDictionary,
    getGlobalSettings,
    loadVisualizer,
    registerCleanup,
  } = params;

  if (!tab.id || popupClosing) return false;
  const dict = params.getDictionary?.() ?? initialDictionary;
  const tabId = tab.id;

  const snapshot = await readCardSnapshot(tabId, params.isBackground === true);
  if (!snapshot || popupClosing) return false;
  const { documentId, status, controlSnapshot, isRemoteActive } = snapshot;
  let acknowledgedSession = snapshot.sessionSnapshot;

	// Processor color is valid only when lifecycle and field-level actual state
	// identify the same document. A direct runtime read may fill this role only
	// for an acknowledged active Capture returned by the currently routed tab.
	if (!audioSessionMatchesControlDocument(acknowledgedSession, controlSnapshot)) acknowledgedSession = null;
	// An extension-page Capture request can commit before its document identity
	// is projected into ControlSnapshot. The direct content runtime read is still
	// routed to this exact tab and can safely prevent a false-blue Capture card;
	// all non-Capture lifecycle colors continue to require the matched session.
	const runtimeCaptureLifecycle = status?.actualMode === 'capture' && status.phase === 'active'
		? status
		: null;
	const lifecycle = acknowledgedSession ?? runtimeCaptureLifecycle;
	const isCaptureActive = isActiveCaptureLifecycle({
		actualMode: lifecycle?.actualMode,
		phase: lifecycle?.phase ?? 'idle',
	});

  const hasActiveMedia = tab.audible || isCaptureActive || status?.isPlaying === true;

  // rule: retention logic ensures a card stays visible for a grace period after audio stops, allowing the user to resume control
  if (params.isBackground && !hasActiveMedia && !isRemoteActive) {
    const pauseRetentionSeconds = getGlobalSettings().pauseRetentionSeconds ?? 60;
    if (pauseRetentionSeconds > 0 && status?.pausedAt) {
      const pausedSeconds = (Date.now() - status.pausedAt) / 1000;
      if (pausedSeconds > pauseRetentionSeconds) {
        return false;
      }
    }
  }

	// ControlSnapshot owns every field-level actual. Runtime/session status below
	// contributes lifecycle only and may never overwrite or backfill these fields.
	const config = initialControlConfig(controlSnapshot);

  const state: CardInternalState = {
    config,
    stableConfig: mergeAudioConfig(config, { eqValues: [...config.eqValues] }),
    controlSnapshot,
    isCaptureActive,
    userInteracted: status?.userInteracted ?? (controlSnapshot?.revision ?? 0) > 0,
    actualMode: lifecycle?.actualMode ?? 'bypass',
    desiredMode: lifecycle?.desiredMode ?? 'bypass',
    phase: lifecycle?.phase ?? 'idle',
    audioDocumentId: lifecycle ? controlSnapshot?.documentId ?? null : null,
    audioOrigin: lifecycle ? controlSnapshot?.origin ?? null : null,
    audioGeneration: lifecycle?.generation ?? -1,
	    audioConfigRevision: acknowledgedSession?.configRevision ?? 0,
    controlGeneration: controlSnapshot?.generation ?? 0,
    controlRevision: controlSnapshot?.revision ?? 0,
    lastError: acknowledgedSession?.lastError ?? status?.lastError ?? null,
    isDragging: false,
    draggingField: null,
  };

  // A document can retire after any asynchronous read; check again at the DOM commit boundary.
  if (!await isCurrentTopDocument(tabId, documentId) || popupClosing) return false;
  const { ui, cardEl } = prepareCardDom({ template, container, tab, dict });
  const cleanupStack: Array<() => void> = [];
  let disposed = false;
  const disposeCard = (): void => {
    if (disposed) return;
    disposed = true;
    for (let index = cleanupStack.length - 1; index >= 0; index -= 1) {
      try {
        cleanupStack[index]?.();
      } catch (error) {
        console.warn('[SPECTRA Popup] Card cleanup failed:', error);
      }
    }
    cleanupStack.length = 0;
  };
  const unregisterAttemptCleanup = registerCleanup?.(disposeCard);
  if (unregisterAttemptCleanup) cleanupStack.push(unregisterAttemptCleanup);
  window.addEventListener('pagehide', disposeCard, { once: true });
  cleanupStack.push(
    () => params.onCardSetChanged?.(),
    () => window.removeEventListener('pagehide', disposeCard),
    () => cardEl.remove(),
  );

  try {
  if (params.isBackground && ui.btnGotoTab) {
    ui.btnGotoTab.classList.remove('hidden');
  }

  const getCapturing = createGetCapturing(state);

  let visualizer: ReturnType<PopupVisualizerFactories['createVizLoop']> | null = null;
  let visualizerRequest = 0;
  let visualizerLoading = false;
  let visualizerLoadFailed = false;
  let render: () => void = () => undefined;
  const getVizEnabled = () => getGlobalSettings().visualizerEnabled !== false;
  const disposeVisualizer = (): void => {
    visualizerRequest += 1;
    visualizerLoading = false;
    visualizer?.dispose();
    visualizer = null;
  };
  cleanupStack.push(disposeVisualizer);
  const reconcileVisualizer = (): void => {
    if (!getVizEnabled() || disposed) {
      disposeVisualizer();
      visualizerLoadFailed = false;
      return;
    }
    if (!loadVisualizer || visualizer || visualizerLoading || visualizerLoadFailed) return;
    const request = ++visualizerRequest;
    visualizerLoading = true;
    void loadVisualizer().then((factories) => {
      if (disposed || request !== visualizerRequest || !getVizEnabled()) return;
      if (ui.canvas) {
        visualizer = factories.createVizLoop({
          canvas: ui.canvas,
          tabId,
          getConfig: () => state.config,
          getCapturing,
          isProcessorActive: () => state.phase === 'active'
            && state.actualMode === 'capture',
			allowCaptureAcquisition: !params.isBackground,
          getGlobalSettings,
        });
        visualizer.start();
      }
      render();
    }).catch((error: unknown) => {
      if (disposed || request !== visualizerRequest) return;
      disposeVisualizer();
      visualizerLoadFailed = true;
      showPopupToast(
        error instanceof Error ? error.message : 'The visualizer could not be started',
        'error',
      );
    }).finally(() => {
      if (request === visualizerRequest) visualizerLoading = false;
    });
  };
  const renderCard = createRenderFn({
    ui,
    state,
    getVizEnabled,
    getGlobalSettings,
  });
  render = () => {
    if (disposed) return;
    reconcileVisualizer();
    renderCard();
    if (getCurrentPanelTabId() === tabId) syncSidePanelState(state.config);
    document.dispatchEvent(new Event(VISUALIZER_STATE_CHANGED_EVENT));
  };

  const onControlError = (error: unknown): void => {
    if (disposed) return;
    reportCardControlFailure(tabId, state, render, error);
  };
  const update = createUpdateFn(
    state,
    tabId,
    getCapturing,
    render,
    getGlobalSettings,
    onControlError,
  );

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
    render,
    onError: onControlError,
  });

  if (ui.icon) {
    bindCardIconClick(ui.icon, tabId, tab.title || '', ui.icon.src);
  }

  // note: register the update handle globally so settings can trigger re-renders from the Settings view
  cleanupStack.push(registerCard(tabId, update, () => state.config, update.flush));

  if (!params.isBackground) {
    cleanupStack.push(setPresetApplyTargetProvider(() => ({
      domain: getDomain(tab.url || ''),
      apply: async (presetConfig) => {
        update(presetConfig);
        await update.flush();
      },
      readCurrent: () => ({ ...state.config, eqValues: [...state.config.eqValues] }),
    })));
  }

  const cleanupMessaging = setupCardMessaging({
    tabId, documentId, state, render,
    onDocumentReplaced: () => {
      disposeCard();
      void chrome.tabs.get(tabId).then(async (currentTab) => {
        if (popupClosing) return;
        await initCard({ ...params, tab: currentTab });
      }).catch((error: unknown) => {
        if (!popupClosing) showPopupToast(error instanceof Error ? error.message : 'Media tab is unavailable', 'error');
      });
    },
  });
  cleanupStack.push(cleanupMessaging);

  cleanupStack.push(registerCardRenderCallback(() => {
    render();
  }));

  render();

  // Snapshot reads stay side-effect free. Once the foreground card is visible,
  // a document-scoped observation lease installs only event listeners/registry
  // state so page-side changes can flow back to Popup. It never admits MAIN,
  // AudioContext or offscreen processing by itself.
  if (!params.isBackground) cleanupStack.push(observePopupTab(tabId, documentId));

  params.onCardSetChanged?.();
  return true;
  } catch (error) {
    disposeCard();
    throw error;
  }
}
