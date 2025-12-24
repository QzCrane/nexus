/**
 * SPECTRA Popup - 卡片 DOM 初始化
 */

import type { I18NDict, CardUIElements } from '../types';
import { getDomain } from '../utils/dom';
import { getCardUIElements } from './ui-elements';

/**
 * 准备卡片 DOM 元素并设置初始文本
 */
export function prepareCardDom(params: {
	template: HTMLTemplateElement;
	container: HTMLElement;
	tab: chrome.tabs.Tab;
	dict: I18NDict;
}): { cardEl: HTMLElement; ui: CardUIElements } {
	const { template, container, tab, dict } = params;

	// 1. 克隆模板
	const cardFragment = template.content.cloneNode(true) as DocumentFragment;
	const cardEl = cardFragment.querySelector('.glass-card') as HTMLElement;
	if (!cardEl) throw new Error('Card element not found in template');

	// 2. 获取 UI 元素引用 (在挂载前获取也是可以的，因为引用的是内存中的 DOM)
	const ui = getCardUIElements(cardEl);
	const domain = getDomain(tab.url || '');

	// 3. 设置初始 UI 文本 (部分元素可能已移至侧边面板，需要空值检查)
	if (ui.tComp) ui.tComp.innerText = dict.comp;
	if (ui.tBass) ui.tBass.innerText = dict.bass;
	if (ui.tMono) ui.tMono.innerText = dict.mono;
	if (ui.tEq) ui.tEq.innerText = dict.eqTitle;
	ui.btnSave.innerText = dict.save;
	ui.btnSave.title = dict.saveTooltip;
	ui.btnReset.innerText = dict.reset;
	ui.btnReset.title = dict.resetTooltip;
	ui.maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
	ui.title.innerText = tab.title || '';
	ui.title.title = tab.title || '';
	ui.domain.innerText = domain;
	ui.icon.src = tab.favIconUrl || 'icon.png';

	// 4. 添加到容器 (移动 Fragment 的内容到 DOM 树)
	container.appendChild(cardFragment);

	// 注意：appendChild 后，cardEl 已经进入了 container
	return { cardEl, ui };
}
