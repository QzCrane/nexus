/**
 * SPECTRA Popup - 设置页逻辑
 */

import type { GlobalSettings } from '@nexus/kernel';
import type { ThemeMode, DomainEntry } from '@nexus/contracts';
import { Actions } from '@nexus/contracts';
import type { I18NDict, RenderCallback } from '../types';
import { getSettingsUIElements, $ } from '../utils/dom';
import { applyTheme, THEME_ICONS, getNextThemeMode } from '../utils/theme';
import { migrateRegistry } from '../utils/registry-helpers';
import { TIMING } from '../constants';
import { applyLang, updateCardsI18n } from './i18n-apply';
import { initRegistryUI } from './registry-ui';

/** 设置页状态 */
export interface SettingsState {
  gSettings: GlobalSettings;
  registryEntries: DomainEntry[];
  dict: I18NDict;
}

/** 卡片渲染回调数组 (供设置变更时触发重绘) */
export const cardRenderCallbacks: RenderCallback[] = [];

/** 默认全局设置 */
const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  osdEnabled: true,
  visualizerEnabled: true,
  lang: 'en-US',
  themeMode: 'system',
  pauseRetentionSeconds: 60,
};

/**
 * 初始化设置页
 * @returns 初始状态
 */
export async function initSettings(): Promise<SettingsState> {
  const ui = getSettingsUIElements();

  // 从存储加载设置 (兼容新旧两种 key)
  const storage = await chrome.storage.local.get(['globalSettings', 'restrictedRegistry', 'userRegistry']);
  let gSettings: GlobalSettings = storage.globalSettings || { ...DEFAULT_GLOBAL_SETTINGS };

  // 读取注册表 (优先使用新 key，fallback 到旧 key)
  let registryEntries: DomainEntry[] = migrateRegistry(storage.restrictedRegistry || storage.userRegistry);

  // 初始化 UI 状态
  initUIState(ui, gSettings, registryEntries);

  // 初始化主题
  initTheme(gSettings.themeMode ?? 'system');

  // 应用语言
  let dict = applyLang(gSettings.lang);

  // 设置变更处理函数
  const saveSettings = () => {
    const selTheme = $<HTMLSelectElement>('set-theme');
    const pauseRetentionInput = $<HTMLInputElement>('set-pause-retention');
    gSettings = {
      osdEnabled: ui.swOsd?.checked ?? true,
      visualizerEnabled: ui.swViz?.checked ?? true,
      lang: (ui.selLang?.value as GlobalSettings['lang']) ?? 'en-US',
      themeMode: (selTheme?.value as ThemeMode) ?? 'system',
      pauseRetentionSeconds: parseInt(pauseRetentionInput?.value || '60', 10),
    };

    // 应用主题并更新按钮图标
    applyTheme(gSettings.themeMode);
    const btnTheme = $<HTMLButtonElement>('btn-theme');
    if (btnTheme) btnTheme.textContent = THEME_ICONS[gSettings.themeMode];


    // 保存并广播
    chrome.storage.local.set({ globalSettings: gSettings });
    broadcastSettings(gSettings);

    // 更新语言和卡片
    dict = applyLang(gSettings.lang);
    updateCardsI18n(dict, gSettings.visualizerEnabled);
    cardRenderCallbacks.forEach((cb) => cb());
  };

  // 绑定事件
  bindSettingsEvents(ui, saveSettings);
  bindThemeButtonEvent(() => gSettings, (s) => { gSettings = s; });

  // 初始化注册表 UI
  initRegistryUI(registryEntries);

  return { gSettings, registryEntries, dict };
}

/** 初始化 UI 状态 */
function initUIState(
  ui: ReturnType<typeof getSettingsUIElements>,
  gSettings: GlobalSettings,
  _registryEntries: DomainEntry[]
): void {
  if (ui.swOsd) ui.swOsd.checked = gSettings.osdEnabled;
  if (ui.swViz) ui.swViz.checked = gSettings.visualizerEnabled !== false;
  if (ui.selLang) ui.selLang.value = gSettings.lang;
  const pauseRetentionInput = $<HTMLInputElement>('set-pause-retention');
  if (pauseRetentionInput) pauseRetentionInput.value = String(gSettings.pauseRetentionSeconds ?? 60);
}

/** 初始化主题 */
function initTheme(themeMode: ThemeMode): void {
  applyTheme(themeMode);
  const selTheme = $<HTMLSelectElement>('set-theme');
  if (selTheme) selTheme.value = themeMode;
  const btnTheme = $<HTMLButtonElement>('btn-theme');
  if (btnTheme) btnTheme.textContent = THEME_ICONS[themeMode];
}

/** 绑定标准设置事件 */
function bindSettingsEvents(
  ui: ReturnType<typeof getSettingsUIElements>,
  saveSettings: () => void
): void {
  if (ui.swOsd) ui.swOsd.onchange = saveSettings;
  if (ui.swViz) ui.swViz.onchange = saveSettings;
  if (ui.selLang) ui.selLang.onchange = saveSettings;
  const selTheme = $<HTMLSelectElement>('set-theme');
  if (selTheme) selTheme.onchange = saveSettings;
  const pauseRetentionInput = $<HTMLInputElement>('set-pause-retention');
  if (pauseRetentionInput) pauseRetentionInput.onchange = saveSettings;
}

/** 绑定主题按钮事件 */
function bindThemeButtonEvent(
  getSettings: () => GlobalSettings,
  setSettings: (s: GlobalSettings) => void
): void {
  const btnTheme = $<HTMLButtonElement>('btn-theme');
  if (!btnTheme) return;
  btnTheme.onclick = () => {
    const current = getSettings();
    const nextMode = getNextThemeMode(current.themeMode ?? 'system');
    const updated = { ...current, themeMode: nextMode };
    setSettings(updated);
    applyTheme(nextMode);
    btnTheme.textContent = THEME_ICONS[nextMode];
    const selTheme = $<HTMLSelectElement>('set-theme');
    if (selTheme) selTheme.value = nextMode;
    chrome.storage.local.set({ globalSettings: updated });
  };
}

/** 广播设置到所有标签页 */
function broadcastSettings(gSettings: GlobalSettings): void {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id) {
        chrome.tabs.sendMessage(t.id, { action: Actions.GLOBAL_SETTINGS_UPDATE, settings: gSettings }).catch(() => { });
      }
    });
  });
}

