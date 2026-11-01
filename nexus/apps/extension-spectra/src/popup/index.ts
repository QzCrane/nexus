// goal: main entry point for the SPECTRA popup; orchestrate UI initialization and tab-specific card rendering

import { $, isRestrictedUrl } from './utils';
import { initNavigation } from './views/navigation';
import { initSettings, type SettingsState } from './views/settings';
import { initCard, CARD_SNAPSHOT_CONCURRENCY } from './card';
import { installAccessibilityPolicy } from '../shared/accessibility';
import { installPopupOptionalPermissionAdmission } from './optional-permission-ui';
import { disableSmoothScroll, enableSmoothScroll } from '../shared/smooth-scroll';
import { sendSpectraRequest } from '../shared/ui-spectra-client';
import { clearPopupStartupError, showPopupStartupError } from './startup-error';
import { runBoundedCardBootstrap } from './bounded-card-bootstrap';
import { flushPredictedFrameHeight, releasePopupFrame, reservePopupFrame, trackPopupFrame } from './frame-height';
import { getSettingsSnapshot } from '../shared/settings-client';
import { loadPopupLocaleCatalog } from '../shared/i18n/popup-catalog';
import { EN_US } from './constants/i18n/en';
import { DEFAULT_GLOBAL_SETTINGS, type GlobalSettings } from '@nexus/kernel';
import type { I18NDict } from './types';
import { readVisibleMediaTabIdsFromStorage } from './media-inventory-from-storage';

type PopupVisualizerModule = typeof import('./visualizer/loop');

let visualizerLoad: Promise<PopupVisualizerModule> | null = null;
const popupAttemptDisposers = new Set<() => void>();
let popupRetired = false;

function tabIdMap(tabs: readonly chrome.tabs.Tab[]): Map<number, chrome.tabs.Tab> {
	return new Map(tabs.flatMap((tab) => tab.id === undefined ? [] : [[tab.id, tab] as const]));
}

async function loadPopupVisualizer(): Promise<PopupVisualizerModule> {
	const pending = visualizerLoad ?? import('./visualizer/loop');
	visualizerLoad = pending;
	try {
		return await pending;
	} catch (error) {
		if (visualizerLoad === pending) visualizerLoad = null;
		throw error;
	}
}

function registerPopupAttemptDisposer(dispose: () => void): () => void {
	if (popupRetired) { dispose(); return () => undefined; }
	popupAttemptDisposers.add(dispose);
	return () => popupAttemptDisposers.delete(dispose);
}

function disposePopupAttempt(): void {
	delete document.documentElement.dataset.spectraReady;
	for (const dispose of popupAttemptDisposers) {
		try {
			dispose();
		} catch (error) {
			console.warn('[SPECTRA Popup] Startup cleanup failed:', error);
		}
	}
	popupAttemptDisposers.clear();
}

async function startPopup(): Promise<void> {
	try {
		await main();
	} catch (error) {
		console.error('[SPECTRA Popup] Startup failed:', error);
		disposePopupAttempt();
		releasePopupFrame();
		document.documentElement.dataset.spectraReady = 'failed';
		try {
			showPopupStartupError(error, startPopup);
		} catch (surfaceError: unknown) {
			console.error('[SPECTRA Popup] Unable to present startup failure:', surfaceError);
		}
	}
}

document.documentElement.dataset.spectraSurface = chrome.extension.getViews({ type: 'popup' })
	.some((view) => view === window) ? 'action-popup' : 'extension-page';

// The frame reservation and every live request start while this module body is
// executing. None of them waits for settings, the side panel, or DOMContentLoaded,
// so the Popup's first paint is never gated on the slowest read.
reservePopupFrame();
const activeTabRequest = chrome.tabs.query({ active: true, currentWindow: true })
	.then((tabs) => tabs[0] ?? null)
	.catch(() => null);
const allTabsRequest = chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
const inventoryRequest = sendSpectraRequest('spectra.tab.visible.list', {});

// Warm the settings snapshot and the locale assets: card rendering must not
// be serialized behind those two reads. A failed warm-up only sends
// initSettings down its own path, so card rendering is unaffected.
void getSettingsSnapshot()
	.then((snapshot) => loadPopupLocaleCatalog(snapshot.globalSettings.lang))
	.catch(() => undefined);

// Fast inventory: project the visible media tabs straight from the durable
// facts plus Chrome's audible flag, without a round trip to the background.
// null means the read failed and the RPC above remains the fallback.
const storageInventoryRequest = allTabsRequest
	.then((tabs) => readVisibleMediaTabIdsFromStorage(tabs))
	.catch(() => null);

async function main(): Promise<void> {
	disposePopupAttempt();
	clearPopupStartupError();
	// A retried bootstrap starts from the released frame again, so the
	// reservation has to be re-applied here: without it the retry opens on an
	// empty document and grows into the layout, which is the jump this whole
	// mechanism exists to remove.
	reservePopupFrame();
	trackPopupFrame();
	void installAccessibilityPolicy().catch((error: unknown) => {
		console.debug('[SPECTRA Popup] Accessibility policy was not installed:', error);
	});
	enableSmoothScroll();
	registerPopupAttemptDisposer(disableSmoothScroll);
	try {
		initNavigation();
	} catch (error) {
		console.error('[SPECTRA Popup] initNavigation failed:', error);
	}

	// Settings initialisation runs in parallel with tabs/inventory: card
	// rendering is no longer serialized behind the settings RPC or the locale
	// asset download. Until they are ready the built-in English dictionary and
	// the default global settings stand in; once they land, the projection
	// chain in initSettings overwrites them in place.
	let settings: SettingsState | null = null;
	const settingsPromise = initSettings().then((resolved) => {
		settings = resolved;
		if (popupRetired) return resolved;
		registerPopupAttemptDisposer(resolved.dispose);
		registerPopupAttemptDisposer(installPopupOptionalPermissionAdmission());
		void import('./side-panel').then(({ initSidePanel }) => {
			if (!popupRetired) registerPopupAttemptDisposer(initSidePanel());
		}).catch((error: unknown) => {
			console.error('[SPECTRA Popup] initSidePanel failed:', error);
		});
		return resolved;
	});
	const getGlobalSettings = (): GlobalSettings => settings?.gSettings ?? DEFAULT_GLOBAL_SETTINGS;
	const getDictionary = (): I18NDict => settings?.dict ?? EN_US;

	const mainStage = $<HTMLElement>('main-stage');
	const bgStack = $<HTMLElement>('bg-stack');
	const bgHeader = $<HTMLElement>('bg-header');
	const bgBadge = $<HTMLElement>('bg-badge');
	const template = $<HTMLTemplateElement>('tmpl-card');
	const emptyState = $<HTMLElement>('empty-state');
	const viewContainer = document.querySelector<HTMLElement>('.view-container');
	if (!mainStage || !bgStack || !template || !emptyState || !viewContainer) {
		throw new Error('Required Popup DOM elements are missing');
	}

	let renderedActiveTabId: number | null = null;
	let connectedTabId: number | null = null;
	let activePort: chrome.runtime.Port | null = null;
	const renderedBackgroundTabIds = new Set<number>();
	const cardDisposers = new Map<number, () => void>();
	const pendingCards = new Set<Promise<boolean>>();
	registerPopupAttemptDisposer(() => activePort?.disconnect());

	const reconcileCardInventory = (): void => {
		if (popupRetired) return;
		const backgroundCount = bgStack.children.length;
		if (bgBadge) bgBadge.textContent = String(backgroundCount);
		bgHeader?.classList.toggle('hidden', backgroundCount === 0);
		// The empty state is a result, never a starting point: the card inventory
		// decides it. Painting it before the first card arrives is what made every
		// open look like the cards were being rebuilt from scratch.
		const hasCards = mainStage.children.length > 0 || backgroundCount > 0;
		emptyState.classList.toggle('hidden', hasCards);
		emptyState.hidden = hasCards;
	};

	const registerCardCleanup = (tabId: number) => (dispose: () => void): (() => void) => {
		cardDisposers.set(tabId, dispose);
		const unregister = registerPopupAttemptDisposer(() => {
			if (cardDisposers.get(tabId) === dispose) cardDisposers.delete(tabId);
			dispose();
		});
		return () => {
			if (cardDisposers.get(tabId) === dispose) cardDisposers.delete(tabId);
			unregister();
		};
	};

	const startCard = (tab: chrome.tabs.Tab, background: boolean): Promise<boolean> => {
		const tabId = tab.id;
		if (tabId === undefined) return Promise.resolve(false);
		if (background) renderedBackgroundTabIds.add(tabId);
		else renderedActiveTabId = tabId;
		const operation = initCard({
			container: background ? bgStack : mainStage,
			template,
			tab,
			dict: getDictionary(),
			getGlobalSettings,
			getDictionary,
			onCardSetChanged: reconcileCardInventory,
			loadVisualizer: loadPopupVisualizer,
			registerCleanup: registerCardCleanup(tabId),
			isBackground: background,
			allowCached: true,
		}).then((initialized) => {
			if (!initialized) {
				renderedBackgroundTabIds.delete(tabId);
				if (renderedActiveTabId === tabId) renderedActiveTabId = null;
			}
			reconcileCardInventory();
			return initialized;
		}).catch((error: unknown) => {
			renderedBackgroundTabIds.delete(tabId);
			if (renderedActiveTabId === tabId) renderedActiveTabId = null;
			console.debug(`[SPECTRA Popup] Card ${tabId} was not initialized:`, error);
			reconcileCardInventory();
			return false;
		}).finally(() => { pendingCards.delete(operation); });
		pendingCards.add(operation);
		return operation;
	};

	const disposeRenderedCard = (tabId: number): void => {
		renderedBackgroundTabIds.delete(tabId);
		if (renderedActiveTabId === tabId) renderedActiveTabId = null;
		const dispose = cardDisposers.get(tabId);
		if (dispose) dispose();
		else document.querySelector(`.glass-card[data-tab-id="${tabId}"]`)?.remove();
		reconcileCardInventory();
	};

	const connectActiveTab = (tabId: number): void => {
		if (connectedTabId === tabId) return;
		activePort?.disconnect();
		connectedTabId = tabId;
		try {
			activePort = chrome.tabs.connect(tabId, { name: 'popup-connection' });
			activePort.onDisconnect.addListener(() => {
				void chrome.runtime.lastError;
				if (connectedTabId === tabId) connectedTabId = null;
				activePort = null;
			});
		} catch (error) {
			activePort = null;
			console.debug('[SPECTRA Popup] Active-tab connection unavailable:', error);
		}
	};

	const [liveActiveTab, allTabs, storageInventory] = await Promise.all([
		activeTabRequest,
		allTabsRequest,
		storageInventoryRequest,
	]);
	if (popupRetired) return;
	const activeTab = liveActiveTab;
	const activeTabId = activeTab?.id;
	const allTabsById = tabIdMap(allTabs);

	if (activeTab && activeTabId !== undefined && !isRestrictedUrl(activeTab.url)) {
		connectActiveTab(activeTabId);
		void startCard(activeTab, false);
	}

	// Applies one authoritative tab-id list to the background card stack: every
	// rendered card not in the list is retired, and every listed tab without a
	// card gets one. The same routine serves the fast first paint and the later
	// RPC reconciliation, so the two can never diverge on their card set.
	const applyInventory = async (tabIds: readonly number[]): Promise<void> => {
		document.documentElement.dataset.mediaInventory = 'complete';
		const liveIds = new Set(tabIds);
		for (const renderedId of [...renderedBackgroundTabIds]) {
			if (!liveIds.has(renderedId) || renderedId === activeTabId) disposeRenderedCard(renderedId);
		}
		const backgroundTabs = tabIds
			.filter((tabId) => tabId !== activeTabId && !renderedBackgroundTabIds.has(tabId))
			.map((tabId) => allTabsById.get(tabId))
			.filter((tab): tab is chrome.tabs.Tab => tab !== undefined && !isRestrictedUrl(tab.url));
		await runBoundedCardBootstrap(backgroundTabs, CARD_SNAPSHOT_CONCURRENCY,
			async (tab) => startCard(tab, true));
	};

	// First paint answers from the durable facts, not from a service-worker round
	// trip. The RPC is still awaited once for correctness, but it no longer gates
	// the cards the user sees.
	if (storageInventory !== null) {
		await applyInventory(storageInventory);
	} else {
		const rpcResult = await inventoryRequest;
		if (rpcResult.ok) {
			await applyInventory(rpcResult.data.tabs);
		} else {
			document.documentElement.dataset.mediaInventory = 'unavailable';
			console.warn('[SPECTRA Popup] Visible tab list unavailable:', rpcResult.error.message);
		}
	}

	// Reconcile any drift between the durable-fact forecast and the background's
	// live answer. Identical lists skip the work entirely; this only fires when a
	// tab navigated or reported media in the instant the Popup was opening.
	void inventoryRequest.then(async (result) => {
		if (popupRetired || !result.ok || storageInventory === null) return;
		const same = storageInventory.length === result.data.tabs.length
			&& storageInventory.every((id, index) => id === result.data.tabs[index]);
		if (same) return;
		await applyInventory(result.data.tabs);
	}).catch(() => undefined);

	await Promise.all([...pendingCards]);
	reconcileCardInventory();
	document.documentElement.dataset.spectraReady = 'true';

	// Settings finishing only corrects what is already on screen: the cards
	// have rendered with the built-in English dictionary and the default global
	// settings, and this adds the authoritative dictionary, the Remote UI and
	// the localized strings.
	const resolvedSettings = await settingsPromise;
	if (popupRetired) return;
	settings = resolvedSettings;
	if (!popupRetired) {
		const { updateCardsI18n } = await import('./views/i18n-apply');
		updateCardsI18n(resolvedSettings.dict, resolvedSettings.gSettings.visualizerEnabled);
	}
	if (activeTab && activeTabId !== undefined && !isRestrictedUrl(activeTab.url)) {
		void import('../remote').then(({ bindRemoteUI, updateRemoteI18n }) => {
			if (popupRetired || activeTabId !== activeTab?.id) return;
			registerPopupAttemptDisposer(bindRemoteUI(activeTabId as number, resolvedSettings.dict));
			registerPopupAttemptDisposer(resolvedSettings.onDictionaryChange(updateRemoteI18n));
		}).catch((error: unknown) => {
			console.error('[SPECTRA Popup] bindRemoteUI failed:', error);
		});
	}
}

window.addEventListener('pagehide', () => {
	// The settled height is written a frame after the publish, so a Popup closed
	// in that gap would lose the hint entirely and open at the content height
	// next time. Closing is the last chance to state what this open landed on.
	flushPredictedFrameHeight();
	popupRetired = true;
	disposePopupAttempt();
}, { once: true });
document.addEventListener('DOMContentLoaded', () => { void startPopup(); });
