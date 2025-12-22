/**
 * SPECTRA Popup - 设置页逻辑
 */

import type { GlobalSettings } from '@nexus/kernel';
import type { ThemeMode } from '@nexus/contracts';
import { Actions } from '@nexus/contracts';
import { DefaultRestrictedDomains } from '@nexus/audio-engine';
import type { I18NDict, RenderCallback } from '../types';
import { getSettingsUIElements, $ } from '../utils/dom';
import { applyTheme, THEME_ICONS, getNextThemeMode } from '../utils/theme';
import { TIMING } from '../constants';
import { applyLang, updateCardsI18n } from './i18n-apply';

/** 设置页状态 */
export interface SettingsState {
  gSettings: GlobalSettings;
  userRegistry: string[];
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
};

/**
 * 初始化设置页
 * @returns 初始状态
 */
export async function initSettings(): Promise<SettingsState> {
  const ui = getSettingsUIElements();

  // 从存储加载设置
  const storage = await chrome.storage.local.get(['globalSettings', 'userRegistry']);
  let gSettings: GlobalSettings = storage.globalSettings || { ...DEFAULT_GLOBAL_SETTINGS };
  const userRegistry: string[] = storage.userRegistry || [];

  // 初始化 UI 状态
  initUIState(ui, gSettings, userRegistry);

  // 初始化主题
  initTheme(gSettings.themeMode ?? 'system');

  // 应用语言
  let dict = applyLang(gSettings.lang);

  // 设置变更处理函数
  const saveSettings = () => {
    const selTheme = $<HTMLSelectElement>('set-theme');
    gSettings = {
      osdEnabled: ui.swOsd?.checked ?? true,
      visualizerEnabled: ui.swViz?.checked ?? true,
      lang: (ui.selLang?.value as GlobalSettings['lang']) ?? 'en-US',
      themeMode: (selTheme?.value as ThemeMode) ?? 'system',
    };

    // 应用主题并更新按钮图标
    applyTheme(gSettings.themeMode);
    const btnTheme = $<HTMLButtonElement>('btn-theme');
    if (btnTheme) btnTheme.textContent = THEME_ICONS[gSettings.themeMode];

    // 更新显示状态
    if (ui.groupRegistry) {
      ui.groupRegistry.style.display = gSettings.visualizerEnabled ? 'block' : 'none';
    }

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
  bindRegistryButton(ui);

  return { gSettings, userRegistry, dict };
}

/** 初始化 UI 状态 */
function initUIState(
  ui: ReturnType<typeof getSettingsUIElements>,
  gSettings: GlobalSettings,
  userRegistry: string[]
): void {
  const effectiveList = Array.from(new Set([...userRegistry, ...DefaultRestrictedDomains]));
  if (ui.swOsd) ui.swOsd.checked = gSettings.osdEnabled;
  if (ui.swViz) ui.swViz.checked = gSettings.visualizerEnabled !== false;
  if (ui.selLang) ui.selLang.value = gSettings.lang;
  if (ui.txtRegistry) ui.txtRegistry.value = effectiveList.join('\n');
  if (ui.groupRegistry) {
    ui.groupRegistry.style.display = gSettings.visualizerEnabled !== false ? 'block' : 'none';
  }
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

/** 绑定注册表保存按钮 */
function bindRegistryButton(ui: ReturnType<typeof getSettingsUIElements>): void {
  if (!ui.btnSaveReg) return;
  ui.btnSaveReg.onclick = () => {
    const lines = ui.txtRegistry?.value.split('\n').map((l) => l.trim()).filter((l) => l.length > 0) || [];
    chrome.storage.local.set({ userRegistry: lines }, () => {
      if (ui.btnSaveReg) {
        const originalText = ui.btnSaveReg.innerText;
        ui.btnSaveReg.innerText = 'OK!';
        setTimeout(() => { if (ui.btnSaveReg) ui.btnSaveReg.innerText = originalText; }, TIMING.BUTTON_FEEDBACK_DURATION);
      }
    });
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

/** 获取合并后的受限域名列表 */
export function getEffectiveRegistry(userRegistry: string[]): string[] {
  return Array.from(new Set([...userRegistry, ...DefaultRestrictedDomains]));
}
