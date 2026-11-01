// goal: manages the global settings panel logic, including persistence, theme/language switching, and cross-tab broadcasting

import type { GlobalSettings } from '@nexus/kernel';
import type { SettingsSnapshot, ThemeMode } from '@nexus/contracts';
import type { I18NDict, RenderCallback } from '../types';
import { getSettingsUIElements, $ } from '../utils/dom';
import { applyTheme, THEME_ICONS, getNextThemeMode } from '../utils/theme';
import { applyLang, updateCardsI18n } from './i18n-apply';
import {
  getSettingsSnapshot,
  patchSettings,
  subscribeSettingsSnapshots,
} from '../../shared/settings-client';
import { loadPopupLocaleCatalog } from '../../shared/i18n/popup-catalog';
import { createSerializedToggleQueue } from '../../shared/serialized-toggle';
import { showPopupToast } from '../toast';
import { writeSettingsForecast } from '../settings-forecast';
// The drawer modules ship in the static popup closure on purpose: a lazily
// imported module let the card's save-as-global action reach an uninitialized
// dictionary, and the load cost is marginal next to that failure class.
import {
  disposePresetsUI,
  initPresetsUI,
  updatePresetsI18n,
} from './presets-ui';
import {
  initMediaRouteUI,
  updateMediaRouteI18n,
} from './media-route-ui';

export interface SettingsState {
  gSettings: GlobalSettings;
  dict: I18NDict;
  revision: number;
  dispose: () => void;
  onDictionaryChange: (callback: (dict: I18NDict) => void) => () => void;
}

// cardRenderCallbacks: registry of UI update hooks triggered when global settings (like visualization toggle) change
export const cardRenderCallbacks: RenderCallback[] = [];

export function registerCardRenderCallback(callback: RenderCallback): () => void {
  cardRenderCallbacks.push(callback);
  return () => {
    const index = cardRenderCallbacks.indexOf(callback);
    if (index >= 0) cardRenderCallbacks.splice(index, 1);
  };
}

// post: loads settings from local storage, initializes the side-panel UI, and returns the unified state
export async function initSettings(): Promise<SettingsState> {
  const ui = getSettingsUIElements();

  const snapshot = await getSettingsSnapshot();

  const state = {
    gSettings: snapshot.globalSettings,
    dict: undefined as unknown as I18NDict,
    revision: -1,
    dispose: () => undefined,
    onDictionaryChange: (_callback: (dict: I18NDict) => void) => () => undefined,
  } satisfies SettingsState;

  let disposed = false;
  let unsubscribeSettings: () => void = () => undefined;
  let presetsInitialized = false;
  let disposeMediaRoutes: (() => void) | null = null;
  const dictionaryListeners = new Set<(dict: I18NDict) => void>();

  const ensurePresetsUI = async (): Promise<void> => {
    if (disposed || presetsInitialized) return;
    initPresetsUI(state.dict);
    presetsInitialized = true;
  };

  const onSettingsOpen = (): void => {
	const ensureMediaRoutesUI = async (): Promise<void> => {
		if (disposed || disposeMediaRoutes) return;
		const dispose = await initMediaRouteUI(state.dict);
		if (disposed) dispose();
		else disposeMediaRoutes = dispose;
	};
	void Promise.all([
		ensurePresetsUI(),
		ensureMediaRoutesUI(),
	]).catch((error: unknown) => {
      if (!disposed) {
        showPopupToast(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  };

  state.dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeSettings();
    dictionaryListeners.clear();
    if (presetsInitialized) disposePresetsUI();
		disposeMediaRoutes?.();
		disposeMediaRoutes = null;
    presetsInitialized = false;
    $<HTMLElement>('btn-settings')?.removeEventListener('click', onSettingsOpen);
  };
  state.onDictionaryChange = (callback) => {
    if (disposed) return () => undefined;
    dictionaryListeners.add(callback);
    return () => {
      dictionaryListeners.delete(callback);
    };
  };

  let projectionChain: Promise<void> = Promise.resolve();
  const projectSnapshot = (next: SettingsSnapshot): Promise<void> => {
    projectionChain = projectionChain.catch(() => undefined).then(async () => {
      if (disposed || next.revision <= state.revision) return;
      // The theme is the one setting visible before any text exists, and it does
      // not depend on the locale asset awaited below. Applying it first keeps a
      // reopen from painting the previous theme for the length of that fetch.
      initTheme(next.globalSettings.themeMode ?? 'system');
      // Load external locale data before committing the new revision. A failed
      // asset load therefore leaves the previous snapshot and controls intact.
      await loadPopupLocaleCatalog(next.globalSettings.lang);
      if (disposed) return;
      state.revision = next.revision;
      state.gSettings = next.globalSettings;
      // Every accepted revision, not only the first: a card's shape follows these
      // settings, so the next open has to start from the latest ones rather than
      // from whatever was committed when a Popup happened to be open.
      writeSettingsForecast(next.globalSettings);
      initUIState(ui, state.gSettings);
      initTheme(state.gSettings.themeMode ?? 'system');

      // SettingsSnapshot is the canonical external projection. Re-apply every
      // dependent surface after each accepted revision so a second page cannot
      // leave Popup controls on its previous language/theme/visualizer state.
      state.dict = applyLang(state.gSettings.lang);
      updateCardsI18n(state.dict, state.gSettings.visualizerEnabled);
		if (presetsInitialized) updatePresetsI18n(state.dict);
		updateMediaRouteI18n(state.dict);
		for (const callback of dictionaryListeners) {
			try {
				callback(state.dict);
			} catch (error: unknown) {
				showPopupToast(error instanceof Error ? error.message : String(error), 'error');
			}
		}
		cardRenderCallbacks.forEach((cb) => { cb(); });
    });
    return projectionChain;
  };

  unsubscribeSettings = subscribeSettingsSnapshots((next) => {
    void projectSnapshot(next).catch((error: unknown) => {
      if (!disposed) {
        showPopupToast(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  });
  try {
    await projectSnapshot(snapshot);
    // Close the read-then-listen window: an event accepted while the initial
    // locale asset was loading is already in the shared revision owner.
    await projectSnapshot(await getSettingsSnapshot());
    const saveSettings = async (changes: Partial<GlobalSettings>) => {
      try {
        const updated = await patchSettings({ scope: 'global', changes });
        await projectSnapshot(updated);
      } catch (error: unknown) {
        // Invocation-time state is never rollback authority: a newer external
        // revision may have committed while this patch was in flight. Refresh
        // the shared monotonic snapshot owner, then restore controls from the
        // latest state even when its revision was already projected.
        try {
          await projectSnapshot(await getSettingsSnapshot(true));
        } catch (recoveryError: unknown) {
          console.warn('[SPECTRA Popup] Settings rollback refresh failed:', recoveryError);
        }
        if (!disposed) {
          initUIState(ui, state.gSettings);
          initTheme(state.gSettings.themeMode ?? 'system');
          showPopupToast(error instanceof Error ? error.message : String(error), 'error');
        }
      }
    };

    bindSettingsEvents(ui, saveSettings);
    bindThemeButtonEvent(() => state.gSettings, saveSettings);
    $<HTMLElement>('btn-settings')?.addEventListener('click', onSettingsOpen);
    return state;
  } catch (error) {
    state.dispose();
    throw error;
  }
}

function initUIState(
  ui: ReturnType<typeof getSettingsUIElements>,
  gSettings: GlobalSettings,
): void {
  if (ui.swOsd) ui.swOsd.checked = gSettings.osdEnabled;
  if (ui.swViz) ui.swViz.checked = gSettings.visualizerEnabled !== false;
  if (ui.selLang) ui.selLang.value = gSettings.lang;
  const pauseRetentionInput = $<HTMLInputElement>('set-pause-retention');
  if (pauseRetentionInput) pauseRetentionInput.value = String(gSettings.pauseRetentionSeconds ?? 60);
}

function initTheme(themeMode: ThemeMode): void {
  applyTheme(themeMode);
  const selTheme = $<HTMLSelectElement>('set-theme');
  if (selTheme) selTheme.value = themeMode;
  const btnTheme = $<HTMLButtonElement>('btn-theme');
  if (btnTheme) btnTheme.textContent = THEME_ICONS[themeMode];
}

function bindSettingsEvents(
  ui: ReturnType<typeof getSettingsUIElements>,
  saveSettings: (changes: Partial<GlobalSettings>) => Promise<void>
): void {
  if (ui.swOsd) ui.swOsd.onchange = () => {
    void saveSettings({ osdEnabled: ui.swOsd?.checked ?? true });
  };
  if (ui.swViz) ui.swViz.onchange = () => {
    void saveSettings({ visualizerEnabled: ui.swViz?.checked ?? true });
  };
  if (ui.selLang) ui.selLang.onchange = () => {
    void saveSettings({ lang: (ui.selLang?.value as GlobalSettings['lang']) ?? 'en-US' });
  };
  const selTheme = $<HTMLSelectElement>('set-theme');
  if (selTheme) selTheme.onchange = () => {
    void saveSettings({ themeMode: (selTheme.value as ThemeMode) ?? 'system' });
  };
  const pauseRetentionInput = $<HTMLInputElement>('set-pause-retention');
  if (pauseRetentionInput) pauseRetentionInput.onchange = () => {
    void saveSettings({ pauseRetentionSeconds: parseInt(pauseRetentionInput.value || '60', 10) });
  };
}

// goal: providing a quick-flip toggle for theme mode via the header button, synced with the settings dropdown
function bindThemeButtonEvent(
  getSettings: () => GlobalSettings,
  saveSettings: (changes: Partial<GlobalSettings>) => Promise<void>,
): void {
  const btnTheme = $<HTMLButtonElement>('btn-theme');
  if (!btnTheme) return;
  const toggleQueue = createSerializedToggleQueue({
    readCurrent: () => getSettings().themeMode ?? 'system',
    nextValue: getNextThemeMode,
    commit: nextMode => saveSettings({ themeMode: nextMode }),
    setBusy: busy => {
      if (busy) btnTheme.setAttribute('aria-busy', 'true');
      else btnTheme.removeAttribute('aria-busy');
    },
    // saveSettings owns rollback and user-visible error presentation.
    onError: () => undefined,
  });
  btnTheme.onclick = () => {
    void toggleQueue.enqueue();
  };
}
