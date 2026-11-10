// goal: main entry point for initializing a tab control card, aggregating status probing, DOM setup, and event binding

import {
	createSpectraRequest,
	isActiveCaptureLifecycle,
} from '@nexus/contracts';
import { isSpectraUiResponse } from '@nexus/contracts/ui-runtime';
import { RUNTIME_OBSERVATION_PORT } from '../../shared/runtime-observation';
import {
	acknowledgedProcessorLifecycle,
	evictCachedCardSnapshot,
	readInitialCardSnapshot,
	resolveInitialProcessorLifecycle,
	sessionBelongsToCard,
} from './snapshot';
import { isCurrentTopDocument } from '../../shared/top-document';
import { mediaTabAvailability } from '../../shared/media-card-policy';
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
import { isReportedControlFailure, openPopupControlTransport } from './control-port';
import { createRenderFn, setCardMaskVisible } from './render';
import { createVolumeView } from './volume-view';
import { bindCardEvents } from './events';
import { setupCardMessaging } from './messaging';
import { reportCardControlFailure } from './error';
import { showPopupToast } from '../toast';
import { prepareCardDom } from './dom-init';
import { bindEffectsButton, getCurrentPanelTabId, registerCard } from '../side-panel';
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
  port.postMessage(createSpectraRequest('spectra.content.runtime.ensure', {
    tabId, documentId, reason: 'observation',
  }));
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
  // Live accessor: the card must be able to re-read the dictionary when a
  // status line changes key, not only when the Popup reopens.
  const getDictionary = params.getDictionary ?? (() => initialDictionary);
  const tabId = tab.id;

  // Membership and structure already exist before any per-card observation.
  // Availability never grants control authority over a retired document.
  const { ui, cardEl } = prepareCardDom({ template, container, tab, dict: getDictionary(),
    cardEl: params.cardEl, pending: true });
  const cleanupStack: Array<() => void> = [];
  let disposed = false;
  const current = () => !disposed && !popupClosing && (params.isCurrent?.() ?? true);
  const disposeCard = (): void => {
    if (disposed) return;
    disposed = true;
    for (let index = cleanupStack.length - 1; index >= 0; index -= 1) {
      try { cleanupStack[index]?.(); }
      catch (error) { console.warn('[SPECTRA Popup] Card cleanup failed:', error); }
    }
    cleanupStack.length = 0;
  };
  const unregisterAttemptCleanup = registerCleanup?.(disposeCard);
  if (unregisterAttemptCleanup) cleanupStack.push(unregisterAttemptCleanup);
  window.addEventListener('pagehide', disposeCard, { once: true });
  cleanupStack.push(() => params.onCardSetChanged?.(),
    () => window.removeEventListener('pagehide', disposeCard), () => { if (!params.cardEl) cardEl.remove(); });
  const showUnavailable = (availability: string): boolean => {
    if (!current()) { disposeCard(); return false; }
    const dictionary = getDictionary();
    cardEl.dataset.mediaAvailability = availability;
    cardEl.classList.add('media-unavailable');
    cardEl.removeAttribute('inert');
    cardEl.removeAttribute('aria-busy');
    setCardMaskVisible(ui, true);
    ui.maskText.textContent = dictionary.controlSyncUnavailable;
    const hint = document.createElement('div');
    hint.className = 'sleep-resume-hint';
    hint.textContent = dictionary.btnGotoTab;
    ui.maskText.append(hint);
    ui.mask.setAttribute('aria-label', dictionary.btnGotoTab);
    for (const control of cardEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) {
      control.disabled = control !== ui.btnGotoTab;
    }
    const activate = () => {
      void chrome.tabs.update(tabId, { active: true }).catch((error: unknown) => {
        if (current()) showPopupToast(error instanceof Error ? error.message : dictionary.controlSyncUnavailable, 'error');
      });
    };
    ui.mask.onclick = activate;
    ui.mask.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    };
    if (ui.btnGotoTab) { ui.btnGotoTab.classList.remove('hidden'); ui.btnGotoTab.onclick = activate; }
    cleanupStack.push(() => { ui.mask.onclick = null; ui.mask.onkeydown = null; if (ui.btnGotoTab) ui.btnGotoTab.onclick = null; });
    params.onBindingStateChanged?.({ available: false, documentId: null });
    params.onCardSetChanged?.();
    return true;
  };
  const availability = mediaTabAvailability(tab);
  if (availability !== 'runnable') return showUnavailable(availability);
  const snapshot = await readInitialCardSnapshot(tabId).catch(() => null);
  if (!current()) { disposeCard(); return false; }
  if (!snapshot) return showUnavailable('unavailable');
  const { documentId } = snapshot;
  const status = snapshot.status.state === 'known' ? snapshot.status.value : null;
  const controlSnapshot = snapshot.controlSnapshot.state === 'known' ? snapshot.controlSnapshot.value : null;
  let acknowledgedSession = snapshot.sessionSnapshot.state === 'known' ? snapshot.sessionSnapshot.value : null;

	// Every observation is fenced to this card's exact document. The control
	// projection is the usual witness, but it is an *independent* read: when it
	// is still in flight (or the durable record was retired by the worker) a
	// session that names this card's own document is still this card's session.
	// Discarding it there is what made a hijacked page reopen at native blue and
	// stay blue until the user touched the slider again.
	if (!sessionBelongsToCard(acknowledgedSession, controlSnapshot, documentId)) acknowledgedSession = null;
	// The control snapshot's own processor ACK is a lifecycle statement, so the
	// route colour never depends on a second read that may be slower than this
	// one; the runtime and session can only make it fresher.
	const acknowledgedLifecycle = acknowledgedProcessorLifecycle(controlSnapshot);
	const lifecycle = resolveInitialProcessorLifecycle(status, acknowledgedSession, acknowledgedLifecycle);
	const lifecycleFromSession = lifecycle !== null && lifecycle === acknowledgedSession;
	const audioLifecycle = lifecycleFromSession ? acknowledgedSession : lifecycle === status ? status : null;
	const isCaptureActive = isActiveCaptureLifecycle({
		actualMode: lifecycle?.actualMode,
		phase: lifecycle?.phase ?? 'idle',
	});

	// ControlSnapshot owns every field-level actual. Runtime/session status below
	// contributes lifecycle only and may never overwrite or backfill these fields.
	const config = initialControlConfig(controlSnapshot);

  const state: CardInternalState = {
    config,
    stableConfig: mergeAudioConfig(config, { eqValues: [...config.eqValues] }),
    controlSnapshot,
		controlSnapshotKnown: snapshot.controlSnapshotFresh === true && snapshot.controlSnapshot.state === 'known',
		lifecycleSnapshotKnown: lifecycle !== null,
    isCaptureActive,
    userInteracted: status?.userInteracted ?? (controlSnapshot?.revision ?? 0) > 0,
    actualMode: lifecycle?.actualMode ?? 'bypass',
    desiredMode: lifecycle?.desiredMode ?? 'bypass',
    phase: lifecycle?.phase ?? 'idle',
    // The lifecycle may be the only observation that answered, so its own
    // document identity is the fence - a missing control snapshot is a missing
    // read, not a missing document.
    audioDocumentId: lifecycle
      ? (lifecycleFromSession ? acknowledgedSession?.documentId : controlSnapshot?.documentId) ?? null
      : null,
    audioOrigin: lifecycle
      ? (lifecycleFromSession ? acknowledgedSession?.origin : controlSnapshot?.origin) ?? null
      : null,
    audioGeneration: audioLifecycle?.generation ?? -1,
	    audioConfigRevision: lifecycleFromSession ? acknowledgedSession?.configRevision ?? 0 : 0,
    controlGeneration: controlSnapshot?.generation ?? 0,
    controlRevision: controlSnapshot?.revision ?? 0,
    lastError: lifecycleFromSession ? acknowledgedSession?.lastError ?? null : status?.lastError ?? null,
    draggingField: null,
  };

  // A document can retire after any asynchronous read; check again at the DOM commit boundary.
  const documentCurrent = await isCurrentTopDocument(tabId, documentId);
  if (!current()) { disposeCard(); return false; }
  if (!documentCurrent) {
    const shown = showUnavailable('unavailable');
    params.onDocumentReplaced?.();
    return shown;
  }
  prepareCardDom({ template, container, tab, dict: getDictionary(), cardEl });
  cardEl.dataset.mediaAvailability = 'runnable';
  params.onBindingStateChanged?.({ available: true, documentId });

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
  // One writer for the volume projection, shared by the frame-coalesced render
  // and the synchronous pointer path so they cannot disagree mid-drag.
  const volumeView = createVolumeView(ui);
  const renderCard = createRenderFn({
    tabId,
    ui,
    state,
    volumeView,
    getVizEnabled,
    getGlobalSettings,
    getDictionary,
  });
  const renderImmediate = () => {
    if (disposed) return;
    reconcileVisualizer();
    renderCard();
    if (getCurrentPanelTabId() === tabId) syncSidePanelState(state.config);
    document.dispatchEvent(new Event(VISUALIZER_STATE_CHANGED_EVENT));
  };
  // A volume drag fires oninput at input rate (often >60Hz). Rendering the whole
  // card synchronously per event queued redundant work between frames and
  // starved the main thread, which reads as the slider not tracking the pointer.
  // Coalesce to one frame-aligned paint so the bar advances once per frame with
  // the pointer instead of stuttering behind a growing render backlog.
  let renderScheduled = false;
  render = () => {
    if (disposed || renderScheduled) return;
    // A hidden or background document does not run animation frames, so
    // scheduling there would latch `renderScheduled` and silently block every
    // later paint. Those documents paint synchronously instead.
    if (params.isBackground || document.hidden) {
      renderImmediate();
      return;
    }
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderImmediate();
    });
  };

  const onControlError = (error: unknown): void => {
    if (disposed || isReportedControlFailure(error)) return;
    reportCardControlFailure(tabId, state, render, error);
  };
  const controlTransport = openPopupControlTransport(tabId, documentId);
  cleanupStack.push(controlTransport.dispose);
  const update = createUpdateFn(
    state,
    tabId,
    getCapturing,
    render,
		getGlobalSettings,
		onControlError,
		controlTransport,
  );

  if (ui.vizIsland) {
    ui.vizIsland.classList.toggle('hidden', getGlobalSettings().visualizerEnabled === false);
  }

  bindCardEvents({
    ui,
    state,
    volumeView,
    tabId,
    tabUrl: tab.url || '',
    update,
    getCapturing,
    render,
    onError: onControlError,
  });

  const effectsButton = cardEl.querySelector<HTMLButtonElement>('.btn-effects');
  if (effectsButton) {
    bindEffectsButton(effectsButton, tabId, tab.title || '', ui.icon.src);
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
    hasPendingVolume: update.hasPendingVolume,
		pendingConfigFields: update.pendingConfigFields,
		cachedSnapshotForecast: snapshot.controlSnapshotFresh !== true,
    onDocumentReplaced: () => {
      disposeCard();
      // The cached snapshot belongs to the retired document. Drop it before the
      // re-init so the replacement reads the new document's durable facts instead
      // of re-painting the old card from the in-realm memory cache.
      evictCachedCardSnapshot(tabId);
      if (params.onDocumentReplaced) { params.onDocumentReplaced(); return; }
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

  // Paint the initial card synchronously so it is visible on the first frame;
  // only subsequent high-frequency updates are frame-coalesced.
  renderImmediate();

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
