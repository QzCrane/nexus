/**
 * SPECTRA Popup - Card DOM Init
 */

import type { I18NDict, CardUIElements } from '../types';
import { getDomain } from '../utils/dom';
import { getCardUIElements } from './ui-elements';

export function prepareCardDom(params: {
	template: HTMLTemplateElement;
	container: HTMLElement;
	tab: chrome.tabs.Tab;
	dict: I18NDict;
}): { cardEl: HTMLElement; ui: CardUIElements } {
	const { template, container, tab, dict } = params;

	const cardFragment = template.content.cloneNode(true) as DocumentFragment;
	const cardEl = cardFragment.querySelector('.glass-card') as HTMLElement;
	if (!cardEl) throw new Error('Card element not found in template');

	const ui = getCardUIElements(cardEl);
	const domain = getDomain(tab.url || '');

	// Some elements might be in side panel, check existence
	if (ui.tComp) ui.tComp.innerText = dict.comp;
	if (ui.tBass) ui.tBass.innerText = dict.bass;
	if (ui.tMono) ui.tMono.innerText = dict.mono;
	if (ui.tEq) ui.tEq.innerText = dict.eqTitle;

	ui.btnSave.title = dict.saveTooltip;
	ui.btnReset.title = dict.resetTooltip;
	ui.maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
	ui.title.innerText = tab.title || '';
	ui.title.title = tab.title || '';
	ui.domain.innerText = domain;
	ui.icon.src = tab.favIconUrl || 'icon.png';

	container.appendChild(cardFragment);

	return { cardEl, ui };
}
