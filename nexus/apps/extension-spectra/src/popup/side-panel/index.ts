/**
 * SPECTRA Popup - Side Panel Logic
 * Toggle side panel, pinning, and manage state.
 */

import type { AudioConfig } from '@nexus/kernel';
import { bindSidePanelControls, syncSidePanelState } from './controls';
import { bindVideoControls, setVideoControlTabId } from './video-controls';
import { bindFooterActions } from './footer-actions';
import { getCardRegistration as getCardReg, updateCardConfig as updateReg } from './registry';

export { registerCard, getCardRegistration } from './registry';

interface SidePanelState {
	isOpen: boolean;
	isPinned: boolean;
	currentTabId: number | null;
}

interface SidePanelElements {
	panel: HTMLElement;
	icon: HTMLImageElement;
	title: HTMLElement;
	btnPin: HTMLElement;
	btnClose: HTMLElement;
}

const state: SidePanelState = {
	isOpen: false,
	isPinned: false,
	currentTabId: null,
};

let elements: SidePanelElements | null = null;

export function updateCardConfig(tabId: number, config: AudioConfig): void {
	updateReg(tabId, config);
	// Sync panel if active for this tab
	if (state.isOpen && state.currentTabId === tabId) {
		syncSidePanelState(config);
	}
}

export function initSidePanel(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;

	elements = {
		panel,
		icon: panel.querySelector('.side-panel-icon') as HTMLImageElement,
		title: panel.querySelector('.side-panel-title') as HTMLElement,
		btnPin: panel.querySelector('.btn-pin') as HTMLElement,
		btnClose: panel.querySelector('.btn-close-panel') as HTMLElement,
	};

	// Pin Button
	elements.btnPin?.addEventListener('click', () => {
		state.isPinned = !state.isPinned;
		elements?.btnPin.classList.toggle('active', state.isPinned);
		chrome.storage.local.set({ sidePanelPinned: state.isPinned });
	});

	// Close Button
	elements.btnClose?.addEventListener('click', () => closeSidePanel());

	// Close on outside click (if not pinned)
	document.addEventListener('click', (e) => {
		if (!state.isOpen || state.isPinned) return;
		const target = e.target as HTMLElement;
		if (!elements?.panel.contains(target) && !target.closest('.meta-icon')) {
			closeSidePanel();
		}
	});

	// Restore Pin state
	chrome.storage.local.get(['sidePanelPinned'], (r) => {
		state.isPinned = r.sidePanelPinned ?? false;
		elements?.btnPin.classList.toggle('active', state.isPinned);
	});

	// Footer Actions
	bindFooterActions();
}

/**
 * Bind Card Icon Click
 */
export function bindCardIconClick(
	iconEl: HTMLElement,
	tabId: number,
	tabTitle: string,
	faviconUrl: string,
	i18nTitle?: string
): void {
	iconEl.style.cursor = 'pointer';
	iconEl.title = i18nTitle || 'Click for advanced settings';

	iconEl.addEventListener('click', (e) => {
		e.stopPropagation();
		if (state.isOpen && state.currentTabId === tabId) {
			closeSidePanel();
		} else {
			openSidePanel(tabId, tabTitle, faviconUrl);
		}
	});
}

function openSidePanel(tabId: number, title: string, faviconUrl: string): void {
	if (!elements) return;
	state.isOpen = true;
	state.currentTabId = tabId;

	elements.icon.src = faviconUrl || '';
	elements.title.textContent = title || 'Settings';

	document.documentElement.classList.add('side-panel-open');

	// Double RAF for smooth transition
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			elements?.panel.classList.add('open');
		});
	});

	const reg = getCardReg(tabId);
	if (reg) {
		bindSidePanelControls(reg.getConfig(), reg.update, tabId);
	}

	setVideoControlTabId(tabId);
	bindVideoControls();
}

function closeSidePanel(): void {
	if (!elements) return;
	state.isOpen = false;
	state.currentTabId = null;

	elements.panel.classList.remove('open');

	// Wait for animation (200ms)
	setTimeout(() => {
		document.documentElement.classList.remove('side-panel-open');
	}, 200);
}

export function getCurrentPanelTabId(): number | null {
	return state.currentTabId;
}

export function isSidePanelOpen(): boolean {
	return state.isOpen;
}
