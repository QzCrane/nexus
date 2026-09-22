// goal: manages the lifecycle and visibility of the advanced settings side panel in the popup

import { mergeControlFields } from '../card/types';
import {
	bindSidePanelControls,
	clearSidePanelState,
	disposeSidePanelControls,
	syncSidePanelState,
} from './controls';
import {
	bindVideoControls,
	disposeVideoControls,
	setVideoControlAvailability,
	setVideoControlTabId,
	syncVideoControlSnapshot,
	waitForPendingVideoControlActions,
} from './video-controls';
import { bindFooterActions, unbindFooterActions } from './footer-actions';
import { getCardRegistration as getCardReg } from './registry';
import { getSafeImageUrl } from '../utils/dom';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { showPopupToast } from '../toast';
import {
	getCurrentPanelTabId,
	isCurrentPanelSession,
	setCurrentPanelTabId,
} from './panel-session';
import { subscribePopupTabUiEvents } from '../ui-event-hub';

export { registerCard, getCardRegistration } from './registry';
export { getCurrentPanelTabId } from './panel-session';

interface SidePanelState {
	isOpen: boolean;
	isPinned: boolean;
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
};

let elements: SidePanelElements | null = null;
let lastTrigger: HTMLElement | null = null;
let closeAnimationTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let unsubscribePanelSnapshots: (() => void) | null = null;
let lifecycleController: AbortController | null = null;

// goal: initializes panel DOM references and global event listeners for pinning and dismissal
export function initSidePanel(): () => void {
	if (initialized) return disposeSidePanel;
	const panel = document.getElementById('side-panel');
	if (!panel) return () => undefined;
	initialized = true;
	const controller = new AbortController();
	lifecycleController = controller;
	const listenerOptions = { signal: controller.signal };

	elements = {
		panel,
		icon: panel.querySelector('.side-panel-icon') as HTMLImageElement,
		title: panel.querySelector('.side-panel-title') as HTMLElement,
		btnPin: panel.querySelector('.btn-pin') as HTMLElement,
		btnClose: panel.querySelector('.btn-close-panel') as HTMLElement,
	};

	elements.btnPin?.addEventListener('click', () => {
		state.isPinned = !state.isPinned;
		elements?.btnPin.classList.toggle('active', state.isPinned);
		elements?.btnPin.setAttribute('aria-pressed', String(state.isPinned));
	}, listenerOptions);
	elements.btnPin?.setAttribute('aria-pressed', String(state.isPinned));

	elements.btnClose?.addEventListener('click', () => closeSidePanel(), listenerOptions);
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && state.isOpen) {
			event.preventDefault();
			closeSidePanel();
		}
	}, listenerOptions);
	setPanelAccessibility(false);
	panel.hidden = true;

	// rule: auto-dismiss panel on outside clicks ONLY if the pinning toggle is inactive
	document.addEventListener('click', (e) => {
		if (!state.isOpen || state.isPinned) return;
		const target = e.target as HTMLElement;
		if (!elements?.panel.contains(target) && !target.closest('.btn-effects')) {
			closeSidePanel();
		}
	}, listenerOptions);

	bindFooterActions();
	window.addEventListener('pagehide', disposeSidePanel, {
		once: true,
		signal: controller.signal,
	});
	return disposeSidePanel;
}

export function disposeSidePanel(): void {
	if (!initialized && !elements) return;
	lifecycleController?.abort();
	lifecycleController = null;
	unsubscribePanelSnapshots?.();
	unsubscribePanelSnapshots = null;
	if (closeAnimationTimer) clearTimeout(closeAnimationTimer);
	closeAnimationTimer = null;
	state.isOpen = false;
	state.isPinned = false;
	setCurrentPanelTabId(null);
	setVideoControlAvailability(false);
	disposeVideoControls();
	disposeSidePanelControls();
	unbindFooterActions();
	lastTrigger?.setAttribute('aria-expanded', 'false');
	if (elements) {
		elements.panel.classList.remove('open');
		elements.panel.hidden = true;
		setPanelAccessibility(false);
	}
	document.documentElement.classList.remove('side-panel-open');
	lastTrigger = null;
	elements = null;
	initialized = false;
}

// eff: binds the native Effects button to this card's acknowledged media target
export function bindEffectsButton(
	button: HTMLButtonElement,
	tabId: number,
	tabTitle: string,
	faviconUrl: string,
): void {
	button.setAttribute('aria-expanded', 'false');
	button.setAttribute('aria-controls', 'side-panel');

	const toggle = (e: Event) => {
		e.stopPropagation();
		if (state.isOpen && getCurrentPanelTabId() === tabId) {
			closeSidePanel();
		} else {
			lastTrigger?.setAttribute('aria-expanded', 'false');
			lastTrigger = button;
			button.setAttribute('aria-expanded', 'true');
			openSidePanel(tabId, tabTitle, faviconUrl);
		}
	};
	button.addEventListener('click', toggle);
}

// eff: slides in the advanced panel and binds controls to the target tab's update handle
function openSidePanel(tabId: number, title: string, faviconUrl: string): void {
	if (!elements) return;
	if (closeAnimationTimer) {
		clearTimeout(closeAnimationTimer);
		closeAnimationTimer = null;
	}
	state.isOpen = true;
	const panelSession = setCurrentPanelTabId(tabId);
	unsubscribePanelSnapshots?.();
	unsubscribePanelSnapshots = subscribePopupTabUiEvents(tabId, (message) => {
		if (!state.isOpen || !isCurrentPanelSession(panelSession)
			|| message.type !== 'spectra.control.snapshot.changed') return;
		// Card owns the audio/config projection and synchronizes SidePanel state
		// from its single render. This subscriber owns video-only controls.
		syncVideoControlSnapshot(message.payload);
	});

	elements.icon.src = getSafeImageUrl(faviconUrl, chrome.runtime.getURL('icons/icon48.png'));
	elements.title.textContent = title || 'Settings';

	elements.panel.hidden = false;
	document.documentElement.classList.add('side-panel-open');
	setPanelAccessibility(true);
	setVideoControlTabId(tabId);
	setVideoControlAvailability(false);

	// note: double requestAnimationFrame ensures the 'side-panel-open' layout shift is committed before the 'open' transform starts
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			elements?.panel.classList.add('open');
		});
	});

	const reg = getCardReg(tabId);
	if (reg) {
		bindSidePanelControls(reg.getConfig(), reg.update, tabId);
	}

	bindVideoControls();
	void (async () => {
			await waitForPendingVideoControlActions(tabId);
			if (!state.isOpen || !isCurrentPanelSession(panelSession)) return;
			const response = await sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId });
			if (!state.isOpen || !isCurrentPanelSession(panelSession)) return;
			if (!response.ok) throw new Error(response.error.message);
			if (!response.data) {
				throw new Error('The active video target is unavailable');
			}
			const admission = syncVideoControlSnapshot(response.data);
			// A newer event may beat this passive GET response. In that case the
			// current projection is already authoritative and must remain enabled.
			if (admission === 'stale') return;
			if (admission !== 'accepted') throw new Error('The active video target is unavailable');
			const registration = getCardReg(tabId);
			if (registration) {
				const config = mergeControlFields(registration.getConfig(), response.data.fields);
				syncSidePanelState(config);
			}
		})()
		.catch((error: unknown) => {
			if (state.isOpen && isCurrentPanelSession(panelSession)) {
				setVideoControlAvailability(false);
				showPopupToast(error instanceof Error ? error.message : String(error), 'error');
			}
		});
}

// eff: slides out the panel and cleans up transition classes after the CSS animation completes
function closeSidePanel(): void {
	if (!elements) return;
	state.isOpen = false;
	unsubscribePanelSnapshots?.();
	unsubscribePanelSnapshots = null;
	setCurrentPanelTabId(null);
	setVideoControlTabId(null);
	setVideoControlAvailability(false);
	clearSidePanelState();
	lastTrigger?.setAttribute('aria-expanded', 'false');
	setPanelAccessibility(false);
	lastTrigger?.focus();

	elements.panel.classList.remove('open');

	// note: 200ms delay matches the CSS transition-duration defined in popup.css
	if (closeAnimationTimer) clearTimeout(closeAnimationTimer);
	closeAnimationTimer = setTimeout(() => {
		document.documentElement.classList.remove('side-panel-open');
		if (elements && !state.isOpen) elements.panel.hidden = true;
		closeAnimationTimer = null;
	}, 200);
}

function setPanelAccessibility(open: boolean): void {
	const panel = elements?.panel;
	if (!panel) return;
	panel.setAttribute('aria-hidden', String(!open));
	panel.toggleAttribute('inert', !open);
}
