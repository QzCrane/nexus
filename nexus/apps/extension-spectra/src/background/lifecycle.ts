// goal: manages chrome tab lifecycle events to maintain accurate tab prioritization and state cleanup

import { createSpectraEvent } from '@nexus/contracts';

import {
	cleanupTabState,
	advanceTabDocumentGeneration,
	forgetTabDocumentGeneration,
	markTabActivated,
	markTabAudible,
	retireTabMediaDocument,
	storage,
} from './state';
import { teardownCaptureState } from './handlers/capture';
import {
	bindAudioSessionDocument,
	flushAudioSessions,
	forgetAudioSession,
	removeAudioSession,
} from './audio-session-store';
import { beginDocumentNavigation } from './control-coordinator';
import { settingsRepository } from './settings-repository';
import { clearBadgeUsage } from './badge-usage';
import { mediaFacts } from './media-facts';
import { swLog } from '../shared/logger';
import {
	handleVisualizerTabRemoved,
	invalidateVisualizerDocument,
} from './handlers/audio';

// The Popup caches its last-known-good CardSnapshot under this key in
// chrome.storage.local. It is a projection of the control snapshot and audio
// session, so it must retire with them when a document changes - otherwise a
// reopened Popup would paint a card for a tab that has since navigated away.
const CARD_CACHE_PREFIX = 'spectra.popup.card_cache.';

function evictCardSnapshotCache(tabId: number): Promise<void> {
	return chrome.storage.local.remove(`${CARD_CACHE_PREFIX}${tabId}`).catch(() => undefined);
}

async function clearTabDocumentState(tabId: number, tabClosed = false): Promise<void> {
	const visualizerCleanup = tabClosed
		? handleVisualizerTabRemoved(tabId)
		: invalidateVisualizerDocument(tabId);
	const boundedVisualizerCleanup = visualizerCleanup.catch((error: unknown) => {
		swLog.warn(`[Lifecycle] Visualizer cleanup failed for tab ${tabId}`, error);
	});
	// Queue capture teardown before awaiting storage. Otherwise a newly loaded
	// document can start capture during the storage await and then be torn down by
	// cleanup that belonged to the previous document.
	const captureTeardown = teardownCaptureState(tabId).then(
		(captureStopped) => {
			cleanupTabState(tabId, {
				preserveCapture: !captureStopped,
				preserveMedia: !tabClosed,
			});
			return captureStopped;
		},
		() => {
			cleanupTabState(tabId, { preserveCapture: true, preserveMedia: !tabClosed });
			return false;
		},
	);
	await Promise.all([
		boundedVisualizerCleanup,
		captureTeardown,
		(tabClosed ? storage.tabSession.remove(tabId) : storage.tabSession.flush(tabId))
			.catch(() => undefined),
		(tabClosed
			? forgetAudioSession(tabId, { alreadyFenced: true })
			: removeAudioSession(tabId, { alreadyFenced: true })).catch(() => undefined),
		evictCardSnapshotCache(tabId),
		...(tabClosed ? [clearBadgeUsage(tabId)] : []),
	]);
}

// webNavigation distinguishes a real top-level document replacement from
// history.pushState/hash updates, both of which can surface as tabs.onUpdated
// loading changes while retaining the same Chrome documentId.
export function isTopLevelDocumentNavigation(details: { frameId: number }): boolean {
	return details.frameId === 0;
}

interface SameDocumentNavigationDetails {
	frameId: number;
	tabId: number;
	documentId: string;
	url: string;
}

// Chrome owns same-document navigation detection because History API wrappers
// installed in an isolated content world cannot observe page-world pushState.
export function notifySameDocumentNavigation(details: SameDocumentNavigationDetails): void {
	if (!isTopLevelDocumentNavigation(details)) return;
	const event = createSpectraEvent('spectra.navigation.changed', { url: details.url }, {
		tabId: details.tabId,
		documentId: details.documentId,
	});
	void chrome.tabs.sendMessage(
		details.tabId,
		event,
		{ documentId: details.documentId },
	).catch(() => undefined);
}

// eff: wires up global chrome tab listeners for activation, updates, and removal
export function setupLifecycleListeners(): void {
	const activeTabsByWindow = new Map<number, number>();
	chrome.runtime.onSuspend.addListener(() => {
		void Promise.allSettled([
			storage.tabSession.flush(),
			flushAudioSessions(),
			settingsRepository.flush(),
			mediaFacts.flushMediaFacts(),
		]);
	});

	chrome.webNavigation.onBeforeNavigate.addListener((details) => {
		if (isTopLevelDocumentNavigation(details)) {
			// Retire the old document fact synchronously. Capture/storage cleanup may
			// await, but a late report must never keep the old document visible.
			retireTabMediaDocument(details.tabId);
			// The old document's media fact must never leak to the new document.
			mediaFacts.forgetMediaFact(details.tabId);
			advanceTabDocumentGeneration(details.tabId);
			void beginDocumentNavigation(details.tabId).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Lifecycle] Navigation invalidation settled at browser boundary: ${String(error)}`);
			});
			void clearTabDocumentState(details.tabId);
		}
	});
	chrome.webNavigation.onCommitted.addListener((details) => {
		if (!isTopLevelDocumentNavigation(details) || !details.documentId) return;
		bindAudioSessionDocument(details.tabId, details.documentId);
		const navigationEvent = createSpectraEvent('spectra.navigation.changed', { url: details.url }, {
			tabId: details.tabId,
			documentId: details.documentId,
		});
		void chrome.runtime.sendMessage(navigationEvent).catch(() => undefined);
		let identity: ReturnType<typeof storage.tabSession.identity>;
		try {
			identity = storage.tabSession.identity(details.tabId, details.documentId, details.url);
		} catch { return; }
		void storage.tabSession.rebind(details.tabId, identity).catch(() => undefined);
	});
	chrome.webNavigation.onHistoryStateUpdated.addListener(notifySameDocumentNavigation);
	chrome.webNavigation.onReferenceFragmentUpdated.addListener(notifySameDocumentNavigation);

	chrome.tabs.onActivated.addListener((activeInfo) => {
		const now = Date.now();
		const previousTabId = activeTabsByWindow.get(activeInfo.windowId);
		if (previousTabId !== undefined && previousTabId !== activeInfo.tabId) {
			markTabActivated(previousTabId, now);
		}
		activeTabsByWindow.set(activeInfo.windowId, activeInfo.tabId);
		markTabActivated(activeInfo.tabId, now);
	});

	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		// eff: update activity timestamp if the tab generates sound
		if (changeInfo.audible !== undefined) {
			markTabAudible(tabId, changeInfo.audible);
		}
		if (changeInfo.status === 'complete') {
			// If the completing document has already established media/audio state,
			// refresh its bounded activation grace only when it is the active tab.
			// markTabActivated is a no-op for ordinary tabs and never creates state.
			chrome.tabs.get(tabId).then(tab => {
				if (tab.active) markTabActivated(tabId);
			}).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Lifecycle] Tab ${tabId} disappeared before activation refresh`, error);
			});
		}
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		for (const [windowId, activeTabId] of activeTabsByWindow) {
			if (activeTabId === tabId) activeTabsByWindow.delete(windowId);
		}
		forgetTabDocumentGeneration(tabId);
		mediaFacts.forgetMediaFact(tabId);
		void clearTabDocumentState(tabId, true);
	});

	// Seed only per-window activation ownership after a worker restart. Active
	// browser tabs are not media facts, so this must not create TabAudioState.
	chrome.tabs.query({ active: true }).then(tabs => {
		for (const tab of tabs) {
			if (!tab.id || tab.windowId === undefined) continue;
			activeTabsByWindow.set(tab.windowId, tab.id);
		}
	}).catch((error: unknown) => {
		swLog.warn('[Lifecycle] Unable to seed active-tab ownership after worker start', error);
	});

	// Restore current audible ownership after a service-worker restart. This is a
	// lifecycle seed, not a read-path side effect.
	chrome.tabs.query({ audible: true }).then(tabs => {
		const now = Date.now();
		for (const tab of tabs) {
			if (tab.id) markTabAudible(tab.id, true, now);
		}
	}).catch((error: unknown) => {
		swLog.warn('[Lifecycle] Unable to seed audible-tab ownership after worker start', error);
	});
}
