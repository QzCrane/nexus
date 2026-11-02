// goal: handles the creation and initial population of a tab control card's DOM structure from a template

import type { I18NDict, CardUIElements } from '../types';
import { getDomain, getWebsiteIconUrl } from '../utils/dom';
import { getCardUIElements } from './ui-elements';
import { setCardMaskVisible } from './render';
import { showUnknownVolume } from './volume-view';

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
	cardEl?: HTMLElement;
	pending?: boolean;
}): { cardEl: HTMLElement; ui: CardUIElements } {
	const { template, container, tab, dict } = params;

	const prepaint = params.cardEl
		?? container.querySelector<HTMLElement>(`:scope > .glass-card[data-tab-id="${tab.id}"]`)
		?? container.querySelector<HTMLElement>(':scope > .glass-card[data-spectra-prepaint]:not([data-tab-id])');
	const cardFragment = prepaint ? null : template.content.cloneNode(true) as DocumentFragment;
	const cardEl = prepaint ?? cardFragment?.querySelector<HTMLElement>('.glass-card');
	if (!cardEl) throw new Error('Card element not found in template');
	if (cardEl.classList.contains('media-unavailable')) {
		cardEl.classList.remove('media-unavailable');
		for (const control of cardEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = false;
	}
	delete cardEl.dataset.spectraPrepaint;
	cardEl.toggleAttribute('inert', params.pending === true);
	if (params.pending) cardEl.setAttribute('aria-busy', 'true');
	else cardEl.removeAttribute('aria-busy');

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
	setCardMaskVisible(ui, false);
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
	if (params.pending) {
		cardEl.dataset.mediaAvailability = 'pending';
		showUnknownVolume(ui);
		if (ui.speedInput) ui.speedInput.value = '';
		if (ui.btnPause) {
			ui.btnPause.textContent = '…';
			ui.btnPause.setAttribute('aria-pressed', 'mixed');
			ui.btnPause.setAttribute('aria-busy', 'true');
		}
	}

	if (cardFragment) container.appendChild(cardFragment);

	return { cardEl, ui };
}
