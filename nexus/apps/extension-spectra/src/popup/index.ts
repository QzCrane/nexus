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
import { releasePopupFrame, trackPopupFrame } from './frame-height';
import { installOverlayScrollbar } from './overlay-scrollbar';
import { getSettingsSnapshot } from '../shared/settings-client';
import { getPopupDictionary, loadPopupLocaleCatalog } from '../shared/i18n/popup-catalog';
import { DEFAULT_GLOBAL_SETTINGS, type GlobalSettings } from '@nexus/kernel';
import type { I18NDict } from './types';
import { readMediaMembershipFromStorage } from './media-inventory-from-storage';
import { MEDIA_FACTS_KEY, isStoredMediaFact, mediaTabAvailability, type MediaCardMembership } from '../shared/media-card-policy';
import { prepareCardDom } from './card/dom-init';
import { readSettingsForecast } from './settings-forecast';
import { readPopupAppearance } from '../shared/popup-bootstrap';
import { applyLang } from './views/i18n-apply';

type PopupVisualizerModule = typeof import('./visualizer/loop');

let visualizerLoad: Promise<PopupVisualizerModule> | null = null;
const popupAttemptDisposers = new Set<() => void>();
let popupRetired = false;
// Read synchronously, before anything asynchronous has had a chance to run: the
// last committed settings are what let the first card be drawn in its final
// shape, and what the locale asset can be prefetched for.
const settingsForecast = readSettingsForecast();
const appearance = readPopupAppearance(location.search);
const initialLanguage = appearance?.language ?? settingsForecast?.lang ?? document.documentElement.lang;

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
		applyLang(initialLanguage);
		await main();
	} catch (error) {
		console.error('[SPECTRA Popup] Startup failed:', error);
		disposePopupAttempt();
		for (const slot of document.querySelectorAll('#main-stage > [data-spectra-prepaint], #bg-stack > [data-spectra-prepaint]')) slot.remove();
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

// Tab metadata starts with the module. Prepaint already committed the complete
// announced structure, so no historical frame reservation is needed.
const activeTabRequest = chrome.tabs.query({ active: true, currentWindow: true })
	.then((tabs) => tabs[0] ?? null)
	.catch(() => null);
const allTabsRequest = chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);

// Warm the settings snapshot and the locale assets: card rendering must not
// be serialized behind those two reads. A failed warm-up only sends
// initSettings down its own path, so card rendering is unaffected.
// The render-critical Popup dictionaries are installed by prepaint. Settings
// hydrate asynchronously without introducing an English startup projection.
void loadPopupLocaleCatalog(initialLanguage).catch(() => undefined);
void getSettingsSnapshot()
	.then((snapshot) => loadPopupLocaleCatalog(snapshot.globalSettings.lang))
	.catch(() => undefined);

async function main(): Promise<void> {
	disposePopupAttempt();
	clearPopupStartupError();
	trackPopupFrame();
	// Floating overlay scrollbar: mirrors `html` scroll without consuming layout
	// width, so cards keep equal left/right gutters (the native bar is hidden).
	try {
		registerPopupAttemptDisposer(installOverlayScrollbar());
	} catch (error) {
		console.error('[SPECTRA Popup] overlay scrollbar failed:', error);
	}
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
	// asset download. The announced language and packaged dictionary already
	// own visible text; the settings projection reconciles the same DOM.
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
	const getGlobalSettings = (): GlobalSettings => (
		settings?.gSettings ?? (appearance ? { ...(settingsForecast ?? DEFAULT_GLOBAL_SETTINGS),
			lang: appearance.language, visualizerEnabled: appearance.visualizerEnabled,
			pauseRetentionSeconds: appearance.pauseRetentionSeconds ?? settingsForecast?.pauseRetentionSeconds
				?? DEFAULT_GLOBAL_SETTINGS.pauseRetentionSeconds } : settingsForecast) ?? DEFAULT_GLOBAL_SETTINGS
	);
	const getDictionary = (): I18NDict => settings?.dict ?? getPopupDictionary(initialLanguage);

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
	const pendingStructureCleanups = new Map<number, () => void>();
	const pendingCards = new Set<Promise<boolean>>();
	const cardBindings = new Map<number, { token: object; cardEl: HTMLElement;
		availability: ReturnType<typeof mediaTabAvailability>; documentId: string | null;
		phase: 'queued' | 'hydrating' | 'bound' | 'unavailable' }>();
	const confirmedDocuments = new Map<number, { documentId: string; consumed: boolean }>();
	const requestedRebindings = new Set<number>();
	let attemptLive = true;
	registerPopupAttemptDisposer(() => {
		attemptLive = false;
		for (const binding of cardBindings.values()) binding.cardEl.remove();
		cardBindings.clear(); confirmedDocuments.clear(); requestedRebindings.clear();
	});
	registerPopupAttemptDisposer(() => activePort?.disconnect());

	const reconcileCardInventory = (): void => {
		if (popupRetired || !attemptLive) return;
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
		// initCard now owns the node, replacing the cleanup installed before the
		// bounded worker could start. There must never be an ownerless queued slot.
		pendingStructureCleanups.get(tabId)?.();
		pendingStructureCleanups.delete(tabId);
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

	let scheduleInventoryRefresh = (): void => undefined;
	const requestRebinding = (tabId: number): void => {
		const binding = cardBindings.get(tabId);
		if (!binding || !attemptLive || popupRetired) return;
		requestedRebindings.add(tabId);
		binding.cardEl.setAttribute('inert', '');
		scheduleInventoryRefresh();
	};
	const reconcileDocumentEvidence = (tabId: number): void => {
		const binding = cardBindings.get(tabId);
		const evidence = confirmedDocuments.get(tabId);
		if (!binding || !evidence || evidence.consumed || binding.availability !== 'runnable'
			|| binding.phase === 'queued' || binding.phase === 'hydrating') return;
		evidence.consumed = true;
		if (binding.documentId !== evidence.documentId) requestRebinding(tabId);
	};
	const allocateCard = (tab: chrome.tabs.Tab, background: boolean): { cardEl: HTMLElement; token: object } => {
		const tabId = tab.id as number;
		const token = {};
		if (background) renderedBackgroundTabIds.add(tabId);
		else renderedActiveTabId = tabId;
		const { cardEl } = prepareCardDom({ container: background ? bgStack : mainStage,
			template, tab, dict: getDictionary(), pending: true });
		cardBindings.set(tabId, { token, cardEl, availability: mediaTabAvailability(tab), documentId: null, phase: 'queued' });
		const unregister = registerPopupAttemptDisposer(() => {
			pendingStructureCleanups.delete(tabId);
			cardEl.remove();
		});
		pendingStructureCleanups.set(tabId, unregister);
		return { cardEl, token };
	};
	const startCard = (tab: chrome.tabs.Tab, background: boolean,
		allocated = allocateCard(tab, background)): Promise<boolean> => {
		const tabId = tab.id;
		if (tabId === undefined) return Promise.resolve(false);
		const isCurrent = () => attemptLive && !popupRetired && cardBindings.get(tabId)?.token === allocated.token;
		if (!isCurrent()) return Promise.resolve(false);
		const binding = cardBindings.get(tabId);
		if (binding) binding.phase = 'hydrating';
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
			cardEl: allocated.cardEl,
			isCurrent,
			onDocumentReplaced: () => { if (isCurrent()) requestRebinding(tabId); },
			onBindingStateChanged: (next) => {
				if (!isCurrent() || !binding) return;
				binding.phase = next.available ? 'bound' : 'unavailable';
				binding.documentId = next.documentId;
				reconcileDocumentEvidence(tabId);
			},
		}).then((initialized) => {
			if (!initialized && isCurrent()) {
				disposeRenderedCard(tabId);
			}
			reconcileCardInventory();
			return initialized;
		}).catch((error: unknown) => {
			if (!isCurrent()) return false;
			disposeRenderedCard(tabId);
			console.debug(`[SPECTRA Popup] Card ${tabId} was not initialized:`, error);
			reconcileCardInventory();
			return false;
		}).finally(() => { pendingCards.delete(operation); });
		pendingCards.add(operation);
		return operation;
	};

	const disposeRenderedCard = (tabId: number, preserveStructure = false): void => {
		const card = cardBindings.get(tabId)?.cardEl;
		pendingStructureCleanups.get(tabId)?.();
		pendingStructureCleanups.delete(tabId);
		cardBindings.delete(tabId);
		requestedRebindings.delete(tabId);
		if (!preserveStructure) confirmedDocuments.delete(tabId);
		renderedBackgroundTabIds.delete(tabId);
		if (renderedActiveTabId === tabId) renderedActiveTabId = null;
		const dispose = cardDisposers.get(tabId);
		if (dispose) dispose();
		if (!preserveStructure) (card ?? document.querySelector(`.glass-card[data-tab-id="${tabId}"]`))?.remove();
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

	// The active card is the one card that is certainly coming, and it needs
	// nothing but the active tab: starting it here - instead of after the tab list
	// and the inventory land - is the difference between the first card committing
	// on the first or the second round trip. The structure is already present, so this
	// binds the already visible canonical structure to its current document.
	void activeTabRequest.then((tab) => {
		if (popupRetired || !attemptLive) return;
		if (!tab || tab.id === undefined || isRestrictedUrl(tab.url)) {
			mainStage.querySelector('[data-spectra-prepaint]')?.remove();
			return;
		}
		if (mediaTabAvailability(tab) === 'runnable') connectActiveTab(tab.id);
		void startCard(tab, false);
	}).catch((error: unknown) => {
		console.debug('[SPECTRA Popup] Active card was not started:', error);
	});

	const [liveActiveTab, allTabs] = await Promise.all([
		activeTabRequest,
		allTabsRequest,
	]);
	if (popupRetired || !attemptLive) return;
	const activeTab = liveActiveTab;
	const activeTabId = activeTab?.id;
	let allTabsById = tabIdMap(allTabs);

	let expiryTimer: ReturnType<typeof setTimeout> | null = null;
	const applyInventory = (membership: MediaCardMembership): void => {
		if (!attemptLive || popupRetired) return;
		document.documentElement.dataset.mediaInventory = 'complete';
		const liveIds = new Set(membership.tabs);
		for (const renderedId of [...renderedBackgroundTabIds]) {
			if (!liveIds.has(renderedId) || renderedId === activeTabId) disposeRenderedCard(renderedId);
		}
		// Availability changes retire all writable handles before reusing the
		// same structure as metadata or rebinding a new runnable document.
		for (const [tabId, binding] of [...cardBindings]) {
			const tab = allTabsById.get(tabId);
			if (!tab) { disposeRenderedCard(tabId); continue; }
			if (binding.availability === mediaTabAvailability(tab) && !requestedRebindings.has(tabId)) continue;
			disposeRenderedCard(tabId, true);
			if (tabId === activeTabId) {
				if (mediaTabAvailability(tab) === 'runnable') connectActiveTab(tabId);
				else { activePort?.disconnect(); activePort = null; connectedTabId = null; }
				void startCard(tab, false);
			}
		}
		const currentActive = activeTabId === undefined ? undefined : allTabsById.get(activeTabId);
		if (renderedActiveTabId === null && currentActive && !isRestrictedUrl(currentActive.url)) {
			if (mediaTabAvailability(currentActive) === 'runnable') connectActiveTab(activeTabId as number);
			void startCard(currentActive, false);
		}
		const backgroundTabs = membership.tabs
			.filter((tabId) => tabId !== activeTabId)
			.map((tabId) => allTabsById.get(tabId))
			.filter((tab): tab is chrome.tabs.Tab => tab !== undefined && !isRestrictedUrl(tab.url));
		const jobs: Array<{ tab: chrome.tabs.Tab; allocated: ReturnType<typeof allocateCard> }> = [];
		// Allocation is synchronous and ordered. Concurrency limits observations,
		// never how many dynamic members can own a visible card.
		let position = bgStack.firstElementChild;
		for (const tab of backgroundTabs) {
			if (!renderedBackgroundTabIds.has(tab.id as number)) jobs.push({ tab, allocated: allocateCard(tab, true) });
			const card = bgStack.querySelector<HTMLElement>(`:scope > .glass-card[data-tab-id="${tab.id}"]`);
			if (card) {
				// Moving an already-ordered node can drop keyboard focus or pointer
				// capture. Unchanged membership must perform no child-list writes.
				if (card !== position) bgStack.insertBefore(card, position);
				position = card.nextElementSibling;
			}
		}
		for (const slot of bgStack.querySelectorAll(':scope > [data-spectra-prepaint]:not([data-tab-id])')) slot.remove();
		void runBoundedCardBootstrap(jobs, CARD_SNAPSHOT_CONCURRENCY,
			({ tab, allocated }) => startCard(tab, true, allocated));
		if (expiryTimer !== null) clearTimeout(expiryTimer);
		expiryTimer = membership.nextExpiryAt === undefined ? null
			: setTimeout(() => { expiryTimer = null; scheduleInventoryRefresh(); }, Math.max(0, membership.nextExpiryAt - Date.now()));
		reconcileCardInventory();
		document.documentElement.dataset.spectraStructureReady = 'true';
		document.documentElement.dataset.spectraReady = 'true';
	};

	let refreshRunning = false;
	let refreshRequested = false;
	let refreshQueued = false;
	let projectedRetention = getGlobalSettings().pauseRetentionSeconds;
	const refreshInventory = async (initialTabs?: chrome.tabs.Tab[]): Promise<void> => {
		if (refreshRunning) { refreshRequested = true; return; }
		refreshRunning = true;
		try {
			do {
				refreshRequested = false;
				const tabs = initialTabs ?? await chrome.tabs.query({});
				initialTabs = undefined;
				projectedRetention = getGlobalSettings().pauseRetentionSeconds;
				const stored = await readMediaMembershipFromStorage(tabs, projectedRetention);
				if (!attemptLive || popupRetired) return;
				if (getGlobalSettings().pauseRetentionSeconds !== projectedRetention) {
					refreshRequested = true;
					continue;
				}
				allTabsById = tabIdMap(tabs);
				if (stored !== null) applyInventory(stored);
				else {
					// Only a failed session read needs a worker round trip.
					const result = await sendSpectraRequest('spectra.tab.visible.list', {});
					if (!attemptLive || popupRetired) return;
					if (result.ok) applyInventory({ tabs: result.data.tabs, inactiveTabs: result.data.inactiveTabs ?? [], nextExpiryAt: result.data.nextExpiryAt });
					else document.documentElement.dataset.mediaInventory = 'unavailable';
				}
			} while (refreshRequested && attemptLive && !popupRetired);
		} finally { refreshRunning = false; }
	};
	scheduleInventoryRefresh = () => {
		if (!attemptLive || popupRetired) return;
		refreshRequested = true;
		if (refreshRunning || refreshQueued) return;
		refreshQueued = true;
		queueMicrotask(() => {
			refreshQueued = false;
			if (attemptLive && !popupRetired) void refreshInventory().catch((error: unknown) => {
				console.debug('[SPECTRA Popup] Inventory refresh failed:', error);
			});
		});
	};
	const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		const change = area === 'session' ? changes[MEDIA_FACTS_KEY] : undefined;
		if (!change) return;
		const records = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
		const previous = records(change.oldValue);
		for (const [key, value] of Object.entries(records(change.newValue))) {
			const tabId = Number(key);
			if (!cardBindings.has(tabId) || !isStoredMediaFact(value) || value.outcome !== 'found' || value.schemaVersion !== 2) continue;
			const old = previous[key];
			const newDocument = !isStoredMediaFact(old) || old.documentId !== value.documentId;
			const newReport = isStoredMediaFact(old) && Number(value.reportRevision) > Number(old.reportRevision ?? 0);
			if ((!newDocument && !newReport) || confirmedDocuments.get(tabId)?.documentId === value.documentId) continue;
			confirmedDocuments.set(tabId, { documentId: value.documentId, consumed: false });
			reconcileDocumentEvidence(tabId);
		}
		scheduleInventoryRefresh();
	};
	const onTabUpdated = (_id: number, change: Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>[1]) => {
		if (change.audible !== undefined || change.discarded !== undefined || change.frozen !== undefined
			|| change.status !== undefined || change.url !== undefined) scheduleInventoryRefresh();
	};
	chrome.storage.onChanged.addListener(onStorageChanged);
	chrome.tabs.onUpdated.addListener(onTabUpdated);
	chrome.tabs.onRemoved.addListener(scheduleInventoryRefresh);
	registerPopupAttemptDisposer(() => {
		chrome.storage.onChanged.removeListener(onStorageChanged);
		chrome.tabs.onUpdated.removeListener(onTabUpdated);
		chrome.tabs.onRemoved.removeListener(scheduleInventoryRefresh);
		if (expiryTimer !== null) clearTimeout(expiryTimer);
	});
	await refreshInventory(allTabs);

	// Settings hydrate controls and Remote UI in place. They do not establish
	// the startup language or replace the prepaint card node.
	const resolvedSettings = await settingsPromise;
	if (popupRetired) return;
	settings = resolvedSettings;
	const onSettingsApplied = () => {
		if (getGlobalSettings().pauseRetentionSeconds !== projectedRetention) scheduleInventoryRefresh();
	};
	registerPopupAttemptDisposer(resolvedSettings.onAppliedRevision(onSettingsApplied));
	// Also closes revisions applied while the initial membership read awaited.
	onSettingsApplied();
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
	popupRetired = true;
	disposePopupAttempt();
	releasePopupFrame();
}, { once: true });
document.addEventListener('DOMContentLoaded', () => { void startPopup(); });
