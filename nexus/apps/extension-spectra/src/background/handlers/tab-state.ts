// goal: manages tab-specific audio activity and visibility states to prioritize the UI tab list

import {
	getOrCreateTabAudioState,
	tabAudioStates,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../state';
import { injectContentScriptOnDemand } from '../upgrade-manager';
import { swLog } from '../../shared/logger';
import {
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { createMediaTabDiscovery } from '../media-tab-discovery';
import { currentTopDocumentId } from '../../shared/top-document';
import { isBackgroundRequestEnvelope, isBackgroundResponse, rpcFailure, rpcSuccess } from '../background-rpc';

export function recordMediaState(
	tabId: number,
	payload: { hasMediaElement: boolean; userInteracted: boolean },
): { reported: true } {
	const state = getOrCreateTabAudioState(tabId);
	state.hasMediaElement = payload.hasMediaElement;

	swLog.debug(`[SPECTRA] Tab ${tabId} reported media: ${payload.hasMediaElement}`);
	return { reported: true };
}

function isRecent(timestamp: number, now: number): boolean {
	return timestamp > 0 && now >= timestamp && now - timestamp < TAB_VISIBLE_THRESHOLD_MS;
}

async function hasNativeMedia(tabId: number): Promise<boolean> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return false;
	// Send directly: the normal UI client may acquire the heavy runtime for an
	// actual.read fallback, which is not allowed merely to enumerate media.
	const response: unknown = await chrome.tabs.sendMessage(tabId, {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type: 'spectra.control.actual.read',
		payload: { fields: ['playing'], target: null },
		tabId,
	}, { documentId });
	if (!(isBackgroundResponse('spectra.control.actual.read', response) && response.ok)) return false;
	return await currentTopDocumentId(tabId) === documentId;
}

function seedVisibleMedia(allTabs: readonly chrome.tabs.Tab[], now: number): Set<number> {
	const visible = new Set<number>();
	const liveTabIds = new Set<number>();
	for (const tab of allTabs) {
		if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0) continue;
		const tabId = Number(tab.id);
		liveTabIds.add(tabId);
		if (tab.audible) visible.add(tabId);
	}
	for (const [tabId, state] of tabAudioStates) {
		if (!liveTabIds.has(tabId)) { tabAudioStates.delete(tabId); continue; }
		const recentlyAudible = isRecent(state.lastAudibleTime, now);
		const activatedMedia = isRecent(state.lastActivatedTime, now) && (state.hasMediaElement || recentlyAudible);
		if (recentlyAudible || activatedMedia) visible.add(tabId);
		else if (!visible.has(tabId)) tabAudioStates.delete(tabId);
	}
	return visible;
}

export const resolveVisibleTabs = createMediaTabDiscovery({
	queryTabs: () => chrome.tabs.query({}),
	seed: seedVisibleMedia,
	probe: hasNativeMedia,
});

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
		if (!isBackgroundRequestEnvelope(message)) {
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

// eff: registers the validated SPECTRA tab-state protocol
export function registerTabStateHandlers(): void {
	registerTabStateV2Listener();
}
