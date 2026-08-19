// goal: manages tab-specific audio activity and visibility states to prioritize the UI tab list

import {
	getOrCreateTabAudioState,
	router,
	tabAudioStates,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../state';
import { injectContentScriptOnDemand } from '../upgrade-manager';
import { swLog } from '../../shared/logger';
import { currentTopDocumentId } from '../../shared/top-document';
import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	isSpectraResponse,
	rpcFailure,
	rpcSuccess,
} from '@nexus/contracts';

const MEDIA_PROBE_CONCURRENCY = 8;

export function recordMediaState(
	tabId: number,
	payload: { hasMediaElement: boolean; userInteracted: boolean },
): { reported: true } {
	const state = getOrCreateTabAudioState(tabId);
	state.hasMediaElement = payload.hasMediaElement;
	state.userManuallyActivated = state.userManuallyActivated || payload.userInteracted;

	swLog.debug(`[SPECTRA] Tab ${tabId} reported media: ${payload.hasMediaElement}`);
	return { reported: true };
}

function isRecent(timestamp: number, now: number): boolean {
	return timestamp > 0 && now >= timestamp && now - timestamp < TAB_VISIBLE_THRESHOLD_MS;
}

function canProbeTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	if (!Number.isInteger(tab.id) || Number(tab.id) <= 0) return false;
	if (!tab.url) return false;
	try {
		const protocol = new URL(tab.url).protocol;
		return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
	} catch {
		return false;
	}
}

async function hasNativeMedia(tabId: number): Promise<boolean> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return false;
	const request = {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.control.actual.read' as const,
		payload: {
			fields: ['playing'] as const,
			target: null,
		},
		tabId,
	};
	try {
		// tabId alone is not a document identity: frameId 0 survives navigation.
		// Bind delivery to the exact top-frame document and, after a positive read,
		// re-read ownership before admitting the tab. A delayed response from the old
		// page can therefore never make the newly navigated page visible in Popup.
		const response: unknown = await chrome.tabs.sendMessage(tabId, request, { documentId });
		if (!(isSpectraResponse('spectra.control.actual.read', response) && response.ok)) return false;
		return await currentTopDocumentId(tabId) === documentId;
	} catch {
		// Restricted pages, disabled file access, stale extension documents and tabs
		// that disappear during Popup discovery are ordinary negative probes.
		return false;
	}
}

async function probeMediaTabs(tabs: readonly (chrome.tabs.Tab & { id: number })[]): Promise<number[]> {
	if (tabs.length === 0) return [];
	const discovered: number[] = [];
	let nextIndex = 0;
	const workerCount = Math.min(MEDIA_PROBE_CONCURRENCY, tabs.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			const tab = tabs[index];
			if (!tab) return;
			if (await hasNativeMedia(tab.id)) discovered.push(tab.id);
		}
	});
	await Promise.all(workers);
	return discovered;
}

export async function resolveVisibleTabs(now = Date.now()): Promise<{ tabs: number[] }> {
	const visibleTabsSet = new Set<number>();
	const allTabs = await chrome.tabs.query({});
	const liveTabIds = new Set<number>();

	// Chrome-owned active/audible facts are zero-probe admission paths.
	for (const tab of allTabs) {
		if (!tab.id) continue;
		liveTabIds.add(tab.id);
		if (tab.active || tab.audible) visibleTabsSet.add(tab.id);
	}

	// Bounded recent activity keeps a just-paused/just-switched live tab stable
	// even when its content host becomes temporarily unreachable during navigation.
	for (const [tabId, state] of tabAudioStates.entries()) {
		if (!liveTabIds.has(tabId)) {
			// onRemoved normally owns this cleanup, but visibility must remain correct
			// if worker/event ordering leaves a stale volatile row behind.
			tabAudioStates.delete(tabId);
			continue;
		}
		const isRecentlyAudible = isRecent(state.lastAudibleTime, now);
		const isRecentlyActivated = isRecent(state.lastActivatedTime, now);
		if (isRecentlyAudible || isRecentlyActivated) {
			visibleTabsSet.add(tabId);
		} else if (!visibleTabsSet.has(tabId)) {
			// Media reports remain telemetry, not a durable visibility lease. The
			// exact current document is re-probed below, so stale service-worker heap
			// cannot keep a removed media surface visible forever.
			tabAudioStates.delete(tabId);
		}
	}

	// Complete multi-tab management cannot depend on a 60-second activity lease:
	// paused and muted media tabs remain valid control targets. Reuse the always-on
	// bootstrap's side-effect-free native `playing` read instead of acquiring the
	// heavy Content Runtime or adding a recurring media heartbeat. Popup discovery
	// is the trigger, probing is bounded, exact-document fenced, and worker restart
	// naturally reconstructs the inventory from live documents.
	const probeCandidates = allTabs.filter(
		(tab): tab is chrome.tabs.Tab & { id: number } => canProbeTab(tab) && !visibleTabsSet.has(tab.id),
	);
	for (const tabId of await probeMediaTabs(probeCandidates)) visibleTabsSet.add(tabId);

	const tabs = Array.from(visibleTabsSet).sort((left, right) => left - right);
	swLog.debug(`[SPECTRA] Resolved visible tabs: ${tabs.join(', ')}`);
	return { tabs };
}

function registerTabStateV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| (candidate.type !== 'spectra.tab.media.report'
				&& candidate.type !== 'spectra.tab.visible.list'
				&& candidate.type !== 'spectra.content.inject')) return false;
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Tab-state RPC is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)
			|| (message.type !== 'spectra.tab.media.report'
				&& message.type !== 'spectra.tab.visible.list'
				&& message.type !== 'spectra.content.inject')) {
			sendResponse(rpcFailure('invalid_request', 'Malformed tab-state request'));
			return false;
		}

		const operation = async () => {
			if (message.type === 'spectra.tab.media.report') {
				const tabId = sender.tab?.id;
				if (!tabId || (message.tabId !== undefined && message.tabId !== tabId)) {
					throw new Error('Media report requires its content-script tab');
				}
				return recordMediaState(tabId, message.payload);
			}
			if (message.type === 'spectra.content.inject') {
				return { injected: await injectContentScriptOnDemand(message.payload.tabId) };
			}
			return resolveVisibleTabs();
		};

		void operation()
			.then((result) => sendResponse(rpcSuccess(result)))
			.catch((error) => sendResponse(rpcFailure(
				'tab_state_unavailable',
				error instanceof Error ? error.message : String(error),
				true,
			)));
		return true;
	});
}

// eff: registers listeners for TAB_REPORT_MEDIA and TAB_GET_VISIBLE_TABS actions
export function registerTabStateHandlers(): void {
	registerTabStateV2Listener();
	router.on('TAB_REPORT_MEDIA', async (req, sender) => {
		const tabId = sender.tab?.id;
		if (!tabId) return;
		recordMediaState(tabId, {
			hasMediaElement: req.hasMediaElement,
			userInteracted: req.userInteracted === true,
		});
	});

	// note: one-release v1 adapters delegate to the same implementations.
	router.on('TAB_GET_VISIBLE_TABS', resolveVisibleTabs);

	// eff: on-demand content script injection when popup detects unreachable tab
	router.on('INJECT_CONTENT_SCRIPT', async (req: { tabId: number }) => {
		if (!req.tabId) return { success: false };
		const ok = await injectContentScriptOnDemand(req.tabId);
		return { success: ok };
	});
}
