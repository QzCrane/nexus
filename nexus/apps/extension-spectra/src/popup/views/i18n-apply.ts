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
