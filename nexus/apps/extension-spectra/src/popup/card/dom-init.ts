// goal: handles the creation and initial population of a tab control card's DOM structure from a template

import type { I18NDict, CardUIElements } from '../types';
import { getDomain, getWebsiteIconUrl } from '../utils/dom';
import { getCardUIElements } from './ui-elements';

function setButtonLabel(button: HTMLElement | null, value: unknown, fallback: string): void {
	if (!button) return;
	const label = typeof value === 'string' && value.trim().length > 0 ? value : fallback;
	button.title = label;
	button.setAttribute('aria-label', label);
}

// eff: clones the card template, injects tab-specific metadata and translations, and appends it to the popup container
export function prepareCardDom(params: {
	template: HTMLTemplateElement;
	container: HTMLElement;
	tab: chrome.tabs.Tab;
	dict: I18NDict;
}): { cardEl: HTMLElement; ui: CardUIElements } {
	const { template, container, tab, dict } = params;

	const prepaint = container.querySelector<HTMLElement>(':scope > .glass-card[data-spectra-prepaint]');
	const cardFragment = prepaint ? null : template.content.cloneNode(true) as DocumentFragment;
	const cardEl = prepaint ?? cardFragment?.querySelector<HTMLElement>('.glass-card');
	if (!cardEl) throw new Error('Card element not found in template');
	delete cardEl.dataset.spectraPrepaint;
	cardEl.removeAttribute('inert');
	cardEl.removeAttribute('aria-busy');

	const ui = getCardUIElements(cardEl);
	const domain = getDomain(tab.url || '');

  setButtonLabel(ui.btnSave, dict.saveTooltip, 'Save');
	setButtonLabel(ui.btnReset, dict.resetTooltip, 'Reset');
	setButtonLabel(ui.btnSaveGlobal, dict.btnSaveAsGlobal, 'Save as Global Preset');
	const effects = cardEl.querySelector<HTMLButtonElement>('.btn-effects');
	if (effects) {
		effects.textContent = dict.effectsLabel;
		setButtonLabel(effects, dict.tipAdvancedSettings, 'Effects');
	}
	const syncStatus = cardEl.querySelector<HTMLElement>('.control-sync-status');
	if (syncStatus) syncStatus.textContent = dict.controlSyncing;
	ui.maskText.textContent = '';
	const paused = document.createElement('div');
	paused.textContent = dict.paused;
	const resume = document.createElement('div');
	resume.className = 'sleep-resume-hint';
	resume.textContent = dict.clickToResume;
	ui.maskText.append(paused, resume);
	ui.title.textContent = tab.title || '';
	ui.title.title = tab.title || '';
	ui.domain.textContent = domain;
	// Stable identity hook so the popup can retire a card whose media tab left
	// the visible inventory during the same open (convergence re-render).
	if (typeof tab.id === 'number') cardEl.dataset.tabId = String(tab.id);
	const fallbackIcon = chrome.runtime.getURL('icons/icon48.png');
	ui.icon.src = getWebsiteIconUrl(tab.url, tab.favIconUrl, fallbackIcon);
	ui.icon.alt = '';
	// rule: provide fallback when favicon fails to load (e.g. CSP restrictions)
	ui.icon.onerror = () => {
		ui.icon.onerror = null;
		ui.icon.src = fallbackIcon;
	};
	ui.mask.setAttribute('role', 'button');
	ui.mask.setAttribute('aria-label', `${dict.paused}. ${dict.clickToResume}`);
	ui.mask.tabIndex = 0;
	ui.slider.setAttribute('aria-label', `Volume for ${tab.title || domain}`);
	ui.mute.setAttribute('aria-label', `${dict.btnMute}: ${tab.title || domain}`);
	ui.mute.setAttribute('aria-pressed', 'false');
	if (ui.btnPause) ui.btnPause.setAttribute('aria-label', dict.btnPause);
	if (ui.btnPip) {
		ui.btnPip.setAttribute('aria-label', dict.btnPip);
		ui.btnPip.setAttribute('aria-pressed', 'false');
	}
	if (ui.btnHotkeyTarget) {
		ui.btnHotkeyTarget.setAttribute('aria-label', dict.btnHotkeyTarget);
		ui.btnHotkeyTarget.setAttribute('aria-pressed', 'false');
	}
	if (ui.btnGotoTab) ui.btnGotoTab.setAttribute('aria-label', dict.btnGotoTab);

	if (cardFragment) container.appendChild(cardFragment);

	return { cardEl, ui };
}
