/**
 * SPECTRA Popup - I18N 应用逻辑
 * 
 * 处理语言切换和卡片文本更新
 */

import type { I18NDict } from '../types';
import { $$ } from '../utils/dom';
import { getDict } from '../constants';

/**
 * 应用语言到所有 [data-i18n] 元素
 * @param lang 语言代码
 * @returns 当前语言字典
 */
export function applyLang(lang: string): I18NDict {
	const dict = getDict(lang);
	if (!dict) return getDict('en-US')!;

	// 处理 innerText
	$$<HTMLElement>('[data-i18n]').forEach((el) => {
		const key = el.dataset.i18n as keyof I18NDict;
		const value = dict[key];
		if (typeof value === 'string') {
			el.innerText = value;
		}
	});

	// 处理 title 属性
	$$<HTMLElement>('[data-i18n-title]').forEach((el) => {
		const key = el.dataset.i18nTitle as keyof I18NDict;
		const value = dict[key];
		if (typeof value === 'string') {
			el.title = value;
		}
	});

	// 处理 placeholder 属性
	$$<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
		const key = el.dataset.i18nPlaceholder as keyof I18NDict;
		const value = dict[key];
		if (typeof value === 'string') {
			el.placeholder = value;
		}
	});

	return dict;
}

/**
 * 更新所有卡片的 i18n 文本
 * @param dict 语言字典
 * @param vizEnabled 可视化是否启用
 */
export function updateCardsI18n(dict: I18NDict, vizEnabled: boolean): void {
	$$<HTMLElement>('.glass-card').forEach((card) => {
		// 更新功能标签
		const keys: Array<keyof I18NDict> = ['comp', 'bass', 'mono', 'eqTitle'];
		keys.forEach((k) => {
			const el = card.querySelector(`[data-i18n="${k}"]`);
			const value = dict[k];
			if (el && typeof value === 'string') el.textContent = value;
		});

		// 更新卡片按钮 title
		const btnSave = card.querySelector('.btn-save') as HTMLElement | null;
		const btnReset = card.querySelector('.btn-reset') as HTMLElement | null;
		if (btnSave) btnSave.title = dict.saveTooltip;
		if (btnReset) btnReset.title = dict.resetTooltip;

		// 更新媒体控制按钮 title
		const btnPause = card.querySelector('.btn-pause') as HTMLElement | null;
		const btnPip = card.querySelector('.btn-pip') as HTMLElement | null;
		const btnHotkey = card.querySelector('.btn-hotkey-target') as HTMLElement | null;
		const btnGotoTab = card.querySelector('.btn-goto-tab') as HTMLElement | null;
		if (btnPause) btnPause.title = dict.btnPause;
		if (btnPip) btnPip.title = dict.btnPip;
		if (btnHotkey) btnHotkey.title = dict.btnHotkeyTarget;
		if (btnGotoTab) btnGotoTab.title = dict.btnGotoTab;

		// 更新 favicon 图标悬停提示
		const metaIcon = card.querySelector('.meta-icon') as HTMLElement | null;
		if (metaIcon) metaIcon.title = dict.tipAdvancedSettings;

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

	// 更新侧边面板按钮
	updateSidePanelI18n(dict);
}

/**
 * 更新侧边面板 i18n
 */
function updateSidePanelI18n(dict: I18NDict): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	// Footer 按钮
	const btnReset = panel.querySelector('.sp-btn-reset') as HTMLElement | null;
	const btnSave = panel.querySelector('.sp-btn-save') as HTMLElement | null;
	if (btnReset) {
		btnReset.textContent = dict.spResetFx;
		btnReset.title = dict.spResetFxTip;
	}
	if (btnSave) {
		btnSave.textContent = dict.spSaveFx;
		btnSave.title = dict.spSaveFxTip;
	}

	// Pin 和 Close 按钮
	const btnPin = panel.querySelector('.btn-pin') as HTMLElement | null;
	const btnClose = panel.querySelector('.btn-close-panel') as HTMLElement | null;
	if (btnPin) btnPin.title = dict.tipPinPanel;
	if (btnClose) btnClose.title = dict.tipClose;
}
