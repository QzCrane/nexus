// goal: main entry point for the SPECTRA popup; orchestrates UI initialization and tab-specific card rendering

import { $, isRestrictedUrl } from './utils';
import { initNavigation } from './views/navigation';
import { initSettings, type SettingsState } from './views/settings';
import { initCard } from './card';
import { enableSmoothScroll } from '../shared/smooth-scroll';
import { sendSpectraRequest } from '../shared/ui-spectra-client';
import { clearPopupStartupError, showPopupStartupError } from './startup-error';
import { runBoundedCardBootstrap } from './bounded-card-bootstrap';

type PopupVisualizerModule = typeof import('./visualizer/loop');

let visualizerLoad: Promise<PopupVisualizerModule> | null = null;
const popupAttemptDisposers = new Set<() => void>();

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
  popupAttemptDisposers.add(dispose);
  return () => popupAttemptDisposers.delete(dispose);
}

function disposePopupAttempt(): void {
  for (const dispose of popupAttemptDisposers) {
    try {
      dispose();
    } catch (error) {
      console.warn('[SPECTRA Popup] Startup cleanup failed:', error);
    }
  }
  popupAttemptDisposers.clear();
}

async function reloadPopup(): Promise<void> {
  // A failed run may already own card listeners, visualizer subscriptions and
  // module-level registries. A document reload is the only complete retry
  // boundary; re-entering main() in the same realm would duplicate owners.
  window.location.reload();
}

// eff: bootstraps the popup UI by identifying active tabs, loading settings, and rendering control cards
async function main(): Promise<void> {
  disposePopupAttempt();
  clearPopupStartupError();
  enableSmoothScroll();

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

  // rule: main-stage is reserved for the current active tab only
  const activeTabId = activeTab?.id;
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

    const mainCardSuccess = await initCard({
      container: mainStage,
      template,
      tab: activeTab,
      dict: settings.dict,
      getGlobalSettings,
      loadVisualizer: loadPopupVisualizer,
      registerCleanup: registerPopupAttemptDisposer,
    });

    if (mainCardSuccess) {
      emptyState.classList.add('hidden');
    }
  }

  let hasBgAudio = false;

  try {
    // goal: render cards for other tabs that were recently audibly active to allow multi-tab management
    const result = await sendSpectraRequest('spectra.tab.visible.list', {});
    if (!result.ok) throw new Error(result.error.message);
    const visibleTabIds = result.data.tabs;
    const allTabs = await chrome.tabs.query({});
    const tabMap = new Map(allTabs.map(t => [t.id, t]));

    const activeTabIdForBackground = activeTab?.id;
    const backgroundTabs = visibleTabIds
      .filter((tabId) => tabId !== activeTabIdForBackground)
      .map((tabId) => tabMap.get(tabId))
      .filter((tab): tab is chrome.tabs.Tab => tab !== undefined && !isRestrictedUrl(tab.url));

    if (backgroundTabs.length > 0) {
      // Bound card bootstrap work so a large visible-tab list cannot serialize
      // dozens of status probes or create an unbounded burst of DOM/visualizer
      // work. Every item settles before badge/empty-state reconciliation.
      const summary = await runBoundedCardBootstrap(backgroundTabs, 4, async (tab) => initCard({
        container: bgStack,
        template,
        tab,
        dict: settings.dict,
        getGlobalSettings,
        loadVisualizer: loadPopupVisualizer,
        registerCleanup: registerPopupAttemptDisposer,
        isBackground: true,
      }));
      hasBgAudio = summary.succeeded > 0;
      if (hasBgAudio) bgHeader?.classList.remove('hidden');
      if (summary.failures.length > 0) {
        console.warn(`[SPECTRA Popup] ${summary.failures.length} background card(s) failed to initialize.`);
      }
    }
  } catch (error) {
    console.warn('[SPECTRA Popup] Visible tab list unavailable.', error);
  }

  if (bgBadge) {
    bgBadge.innerText = String(bgStack.children.length);
  }

  const hasMainCard = mainStage.children.length > 0;
  const hasAnyCard = hasMainCard || hasBgAudio;

  // post: toggle empty state UI if no manageable media tabs were discovered
  if (!hasAnyCard) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }

  const { updateCardsI18n } = await import('./views/i18n-apply');
  updateCardsI18n(settings.dict, settings.gSettings.visualizerEnabled);
}

function startPopup(): void {
  void main().catch((error: unknown) => {
    console.error('[SPECTRA Popup] Startup failed:', error);
    disposePopupAttempt();
    try {
      showPopupStartupError(error, reloadPopup);
    } catch (surfaceError: unknown) {
      console.error('[SPECTRA Popup] Unable to present startup failure:', surfaceError);
    }
  });
}

window.addEventListener('pagehide', disposePopupAttempt, { once: true });
document.addEventListener('DOMContentLoaded', startPopup);
