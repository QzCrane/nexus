// goal: main entry point for the SPECTRA popup; orchestrates UI initialization and tab-specific card rendering

import { $, isRestrictedUrl } from './utils';
import { initNavigation } from './views/navigation';
import { initSettings, type SettingsState } from './views/settings';
import { initCard, CARD_SNAPSHOT_CONCURRENCY } from './card';
import { installAccessibilityPolicy } from '../shared/accessibility';
import { installPopupOptionalPermissionAdmission } from './optional-permission-ui';
import { disableSmoothScroll, enableSmoothScroll } from '../shared/smooth-scroll';
import { sendSpectraRequest } from '../shared/ui-spectra-client';
import { clearPopupStartupError, showPopupStartupError } from './startup-error';
import { runBoundedCardBootstrap } from './bounded-card-bootstrap';

type PopupVisualizerModule = typeof import('./visualizer/loop');

let visualizerLoad: Promise<PopupVisualizerModule> | null = null;
const popupAttemptDisposers = new Set<() => void>();
let popupRetired = false;

function tabIdMap(tabs: readonly chrome.tabs.Tab[]): Map<number, chrome.tabs.Tab> {
  return new Map(tabs.flatMap((tab) => tab.id === undefined ? [] : [[tab.id, tab] as const]));
}

async function loadPopupVisualizer(): Promise<PopupVisualizerModule> {
  const pending = visualizerLoad ?? import('./visualizer/loop');
  visualizerLoad = pending;
  try {
    return await pending;
  } catch (error) {
    if (visualizerLoad === pending) visualizerLoad = null;
    throw error;
  }
}

function registerPopupAttemptDisposer(dispose: () => void): () => void {
  if (popupRetired) { dispose(); return () => undefined; }
  popupAttemptDisposers.add(dispose);
  return () => popupAttemptDisposers.delete(dispose);
}

function disposePopupAttempt(): void {
  delete document.documentElement.dataset.spectraReady;
  for (const dispose of popupAttemptDisposers) {
    try {
      dispose();
    } catch (error) {
      console.warn('[SPECTRA Popup] Startup cleanup failed:', error);
    }
  }
  popupAttemptDisposers.clear();
}

// retry: disposePopupAttempt() releases every owner the failed run registered,
// so a retry re-enters the same bootstrap in place instead of reloading the
// document and losing the Popup window's transient user context.
async function startPopup(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error('[SPECTRA Popup] Startup failed:', error);
    disposePopupAttempt();
    try {
      showPopupStartupError(error, startPopup);
    } catch (surfaceError: unknown) {
      console.error('[SPECTRA Popup] Unable to present startup failure:', surfaceError);
    }
  }
}

// Intrinsic Action-popup sizing must not be determined by its transient initial
// viewport; a tab-hosted extension page, unlike that popup, may reflow narrowly.
document.documentElement.dataset.spectraSurface = chrome.extension.getViews({ type: 'popup' })
  .some((view) => view === window) ? 'action-popup' : 'extension-page';

// eff: bootstraps the popup UI by identifying active tabs, loading settings, and rendering control cards
async function main(): Promise<void> {
  disposePopupAttempt();
  clearPopupStartupError();
  await installAccessibilityPolicy();
  if (popupRetired) return;
  enableSmoothScroll();
  registerPopupAttemptDisposer(disableSmoothScroll);

  let activeTab: chrome.tabs.Tab | null = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
  } catch {
    // note: failure to query tabs usually indicates the popup was opened in a non-browser context (e.g. devtools)
    activeTab = null;
  }

  try {
    initNavigation();
  } catch (error) {
    console.error('[SPECTRA Popup] initNavigation failed:', error);
  }

  const settings: SettingsState = await initSettings();
  registerPopupAttemptDisposer(settings.dispose);
  if (popupRetired) return;
  registerPopupAttemptDisposer(installPopupOptionalPermissionAdmission());

  // eff: lazy load side panel only when needed
  try {
    const { initSidePanel } = await import('./side-panel');
    registerPopupAttemptDisposer(initSidePanel());
  } catch (error) {
    console.error('[SPECTRA Popup] initSidePanel failed:', error);
  }

  if (activeTab?.id) {
    try {
      const { bindRemoteUI, updateRemoteI18n } = await import('../remote');
      const disposeRemoteUI = bindRemoteUI(activeTab.id, settings.dict);
      registerPopupAttemptDisposer(disposeRemoteUI);
      registerPopupAttemptDisposer(settings.onDictionaryChange(updateRemoteI18n));
    } catch (error) {
      console.error('[SPECTRA Popup] bindRemoteUI failed:', error);
    }
  }

  // SettingsState is a live projection owned by views/settings. Cards read it
  // at render time so external revisions cannot strand Popup on an old theme,
  // language, or visualizer setting.
  const getGlobalSettings = () => settings.gSettings;

  const mainStage = $<HTMLElement>('main-stage');
  const bgStack = $<HTMLElement>('bg-stack');
  const bgHeader = $<HTMLElement>('bg-header');
  const bgBadge = $<HTMLElement>('bg-badge');
  const template = $<HTMLTemplateElement>('tmpl-card');
  const emptyState = $<HTMLElement>('empty-state');

  if (!mainStage || !bgStack || !template || !emptyState) {
    throw new Error('Required Popup DOM elements are missing');
  }

  const reconcileCardInventory = (): void => {
    if (popupRetired) return;
    if (bgBadge) bgBadge.innerText = String(bgStack.children.length);
    bgHeader?.classList.toggle('hidden', bgStack.children.length === 0);
    emptyState.classList.toggle('hidden', mainStage.children.length > 0 || bgStack.children.length > 0);
  };

  // rule: main-stage is reserved for the current active tab only
  const activeTabId = activeTab?.id;
  // The inventory request starts before the active-tab card init so a slow or
  // unresponsive active tab cannot delay the media-tab list render.
  const inventoryRequest = sendSpectraRequest('spectra.tab.visible.list', {});
  // The active-tab card boots in parallel with the inventory read; only the
  // final reconcile awaits it, so a busy active tab never blocks the list.
  let activeCardReady: Promise<boolean> | null = null;
  if (activeTab && typeof activeTabId === 'number' && !isRestrictedUrl(activeTab.url)) {
    try {
      // eff: establish a persistent port to the active tab's content script to keep the session alive
      const port = chrome.tabs.connect(activeTabId, { name: 'popup-connection' });
      registerPopupAttemptDisposer(() => port.disconnect());
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
      });
    } catch (error) {
      // note: fail silently if the content script is not yet injected or compatible
      console.debug('[SPECTRA Popup] Active-tab connection unavailable:', error);
    }

    activeCardReady = initCard({
      container: mainStage,
      template,
      tab: activeTab,
      dict: settings.dict,
      getGlobalSettings,
      getDictionary: () => settings.dict,
      onCardSetChanged: reconcileCardInventory,
      loadVisualizer: loadPopupVisualizer,
      registerCleanup: registerPopupAttemptDisposer,
    }).then((mainCardSuccess) => {
      if (mainCardSuccess) {
        emptyState.classList.add('hidden');
      }
      return mainCardSuccess;
    }).catch((error: unknown) => {
      // note: the active tab may be unresponsive or retired; the list still renders
      console.debug('[SPECTRA Popup] Active-tab card unavailable:', error);
      return false;
    });
  }

  let hasBgAudio = false;
  const renderedBackgroundTabIds = new Set<number>();

  // Pending tabs are a transient "checking" state: the settle read converges
  // them in place. Only genuine probe failures (denied/stale/unknown) warrant
  // the partial-inventory warning, and those retry automatically via cooldowns.
  const applyInventoryEvidence = (coverage: {
    status: 'complete' | 'degraded';
    pending: number;
    denied: number;
    stale: number;
    unknown: number;
  } | undefined): void => {
    const genuineFailures = coverage
      ? coverage.denied + coverage.stale + coverage.unknown
      : 0;
    const evidence: 'complete' | 'partial' | 'checking' | 'unknown' = coverage === undefined
      ? 'unknown'
      : coverage.status === 'complete' ? 'complete'
      : genuineFailures > 0 ? 'partial'
      : 'checking';
    document.documentElement.dataset.mediaInventory = evidence;
    const inventoryStatus = document.getElementById('media-inventory-status');
    if (!inventoryStatus) return;
    inventoryStatus.hidden = evidence !== 'partial';
    inventoryStatus.textContent = evidence === 'partial' ? settings.dict.mediaInventoryPartial : '';
  };

  const renderBackgroundTabs = async (
    visibleTabIds: readonly number[],
    tabMap: Map<number, chrome.tabs.Tab>,
  ): Promise<void> => {
    const liveIds = new Set(visibleTabIds);
    // Retire cards whose media tab left the visible inventory during this open.
    for (const renderedId of [...renderedBackgroundTabIds]) {
      if (liveIds.has(renderedId)) continue;
      renderedBackgroundTabIds.delete(renderedId);
      bgStack.querySelector<HTMLElement>(`[data-tab-id="${renderedId}"]`)?.remove();
    }
    const backgroundTabs = visibleTabIds
      .filter((tabId) => tabId !== activeTabId && !renderedBackgroundTabIds.has(tabId))
      .map((tabId) => tabMap.get(tabId))
      .filter((tab): tab is chrome.tabs.Tab => tab !== undefined && !isRestrictedUrl(tab.url));
    if (backgroundTabs.length === 0) return;
    // Bound card bootstrap work so a large visible-tab list cannot serialize
    // dozens of status probes or create an unbounded burst of DOM/visualizer
    // work. Every item settles before badge/empty-state reconciliation.
    const summary = await runBoundedCardBootstrap(backgroundTabs, CARD_SNAPSHOT_CONCURRENCY, async (tab) => {
      const initialized = await initCard({
        container: bgStack,
        template,
        tab,
        dict: settings.dict,
        getGlobalSettings,
        getDictionary: () => settings.dict,
        onCardSetChanged: reconcileCardInventory,
        loadVisualizer: loadPopupVisualizer,
        registerCleanup: registerPopupAttemptDisposer,
        isBackground: true,
      });
      if (initialized && typeof tab.id === 'number') renderedBackgroundTabIds.add(tab.id);
      return initialized;
    });
    hasBgAudio = summary.succeeded > 0;
    if (hasBgAudio) bgHeader?.classList.remove('hidden');
    if (summary.failures.length > 0) {
      console.warn(`[SPECTRA Popup] ${summary.failures.length} background card(s) failed to initialize.`);
    }
  };

  try {
    // goal: render discovered media tabs while retaining the configured display-retention policy
    const result = await inventoryRequest;
    if (!result.ok) throw new Error(result.error.message);
    applyInventoryEvidence(result.data.coverage);
    const allTabs = await chrome.tabs.query({});
    await renderBackgroundTabs(result.data.tabs, tabIdMap(allTabs));

    // Convergence pass: the background sweep solidifies facts for tabs that had
    // no prior report or probe. Re-read once it settles and grow the list in
    // place so newly discovered media tabs appear without reopening the popup.
    void (async () => {
      if (popupRetired) return;
      try {
        const settled = await sendSpectraRequest('spectra.tab.visible.settle', {});
        if (popupRetired || !settled.ok) return;
        applyInventoryEvidence(settled.data.coverage);
        const settledTabs = await chrome.tabs.query({});
        await renderBackgroundTabs(settled.data.tabs, tabIdMap(settledTabs));
      } catch (error) {
        console.debug('[SPECTRA Popup] Inventory convergence update failed:', error);
      }
      reconcileCardInventory();
    })();
  } catch (error) {
    document.documentElement.dataset.mediaInventory = 'unavailable';
    const inventoryStatus = document.getElementById('media-inventory-status');
    if (inventoryStatus) { inventoryStatus.hidden = false; inventoryStatus.textContent = settings.dict.mediaInventoryPartial; }
    console.warn('[SPECTRA Popup] Visible tab list unavailable.', error);
  }

  // The active-tab card was booting in parallel; settle it before the final
  // inventory reconcile so badge/empty-state counts reflect both stages.
  if (activeCardReady) await activeCardReady;

  reconcileCardInventory();

  const { updateCardsI18n } = await import('./views/i18n-apply');
  updateCardsI18n(settings.dict, settings.gSettings.visualizerEnabled);
  document.documentElement.dataset.spectraReady = 'true';
}

window.addEventListener('pagehide', () => { popupRetired = true; disposePopupAttempt(); }, { once: true });
document.addEventListener('DOMContentLoaded', () => { void startPopup(); });
