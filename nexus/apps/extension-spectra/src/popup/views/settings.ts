/**
 * SPECTRA Popup - 设置页逻辑
 */

import type { GlobalSettings } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';
import { DefaultRestrictedDomains } from '@nexus/audio-engine';
import type { I18NDict, RenderCallback } from '../types';
import { getSettingsUIElements, $$ } from '../utils/dom';
import { getDict, TIMING } from '../constants';

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

  // 合并用户列表和默认列表
  const effectiveList = Array.from(new Set([...userRegistry, ...DefaultRestrictedDomains]));

  // 初始化 UI 状态
  if (ui.swOsd) ui.swOsd.checked = gSettings.osdEnabled;
  if (ui.swViz) ui.swViz.checked = gSettings.visualizerEnabled !== false;
  if (ui.selLang) ui.selLang.value = gSettings.lang;
  if (ui.txtRegistry) ui.txtRegistry.value = effectiveList.join('\n');
  if (ui.groupRegistry) {
    ui.groupRegistry.style.display = gSettings.visualizerEnabled !== false ? 'block' : 'none';
  }

  // 应用语言
  let dict = applyLang(gSettings.lang);

  // 设置变更处理函数
  const saveSettings = () => {
    gSettings = {
      osdEnabled: ui.swOsd?.checked ?? true,
      visualizerEnabled: ui.swViz?.checked ?? true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lang: (ui.selLang?.value as any) ?? 'en-US',
    };

    // 更新注册表分组显示
    if (ui.groupRegistry) {
      ui.groupRegistry.style.display = gSettings.visualizerEnabled ? 'block' : 'none';
    }

    // 保存到存储
    chrome.storage.local.set({ globalSettings: gSettings });

    // 广播到所有标签页
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => {
        if (t.id) {
          chrome.tabs.sendMessage(t.id, {
            action: Actions.GLOBAL_SETTINGS_UPDATE,
            settings: gSettings,
          }).catch(() => { });
        }
      });
    });

    // 更新语言
    dict = applyLang(gSettings.lang);

    // 更新所有卡片的 i18n 文本
    updateCardsI18n(dict, gSettings.visualizerEnabled);

    // 触发所有卡片重绘
    cardRenderCallbacks.forEach((cb) => cb());
  };

  // 绑定事件
  if (ui.swOsd) ui.swOsd.onchange = saveSettings;
  if (ui.swViz) ui.swViz.onchange = saveSettings;
  if (ui.selLang) ui.selLang.onchange = saveSettings;

  // 保存注册表按钮
  if (ui.btnSaveReg) {
    ui.btnSaveReg.onclick = () => {
      const lines = ui.txtRegistry?.value
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0) || [];

      chrome.storage.local.set({ userRegistry: lines }, () => {
        if (ui.btnSaveReg) {
          const originalText = ui.btnSaveReg.innerText;
          ui.btnSaveReg.innerText = 'OK!';
          setTimeout(() => {
            if (ui.btnSaveReg) ui.btnSaveReg.innerText = originalText;
          }, TIMING.BUTTON_FEEDBACK_DURATION);
        }
      });
    };
  }

  return { gSettings, userRegistry, dict };
}

/** 应用语言到所有 [data-i18n] 元素 */
function applyLang(lang: string): I18NDict {
  const dict = getDict(lang);
  if (!dict) return getDict('en-US')!;

  $$<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as keyof I18NDict;
    const value = dict[key];
    if (typeof value === 'string') {
      el.innerText = value;
    }
  });
  return dict;
}

/** 更新所有卡片的 i18n 文本 */
function updateCardsI18n(dict: I18NDict, vizEnabled: boolean): void {
  $$<HTMLElement>('.glass-card').forEach((card) => {
    // 更新功能标签
    const keys: Array<keyof I18NDict> = ['comp', 'bass', 'mono', 'eqTitle'];
    keys.forEach((k) => {
      const el = card.querySelector(`[data-i18n="${k}"]`);
      const value = dict[k];
      if (el && typeof value === 'string') el.textContent = value;
    });

    // 更新按钮
    const btnSave = card.querySelector('.btn-save') as HTMLElement | null;
    const btnReset = card.querySelector('.btn-reset') as HTMLElement | null;
    if (btnSave) {
      btnSave.innerText = dict.save;
      btnSave.title = dict.saveTooltip;
    }
    if (btnReset) {
      btnReset.innerText = dict.reset;
      btnReset.title = dict.resetTooltip;
    }

    // 更新暂停遮罩文本
    const maskText = card.querySelector('.sleep-text') as HTMLElement | null;
    if (maskText) {
      maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
    }

    // 更新可视化岛显示状态
    const vizIsland = card.querySelector('.viz-island') as HTMLElement | null;
    if (vizIsland) {
      vizIsland.classList.toggle('hidden', !vizEnabled);
    }
  });
}

/** 获取合并后的受限域名列表 */
export function getEffectiveRegistry(userRegistry: string[]): string[] {
  return Array.from(new Set([...userRegistry, ...DefaultRestrictedDomains]));
}
