// goal: manages tab-specific audio activity and visibility states to prioritize the UI tab list

import {
	getOrCreateTabAudioState,
	tabAudioStates,
	tabDocumentGeneration,
	TAB_VISIBLE_THRESHOLD_MS,
} from '../state';
import { injectContentScriptOnDemand } from '../upgrade-manager';
import { swLog } from '../../shared/logger';
import {
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { createMediaTabDiscovery, type MediaProbeResult } from '../media-tab-discovery';
import { mediaFacts } from '../media-facts';
import { currentTopDocumentId } from '../../shared/top-document';
import { isBackgroundRequestEnvelope, rpcFailure, rpcSuccess , RPC_INVALID_REQUEST} from '../background-rpc';

export type MediaReportOrdering =
	| { status: 'ordered'; revision: number }
	| { status: 'legacy-unversioned' };

export function classifyMediaReport(
	payload: { reportRevision?: number },
): MediaReportOrdering {
	return payload.reportRevision === undefined
		? { status: 'legacy-unversioned' }
		: { status: 'ordered', revision: payload.reportRevision };
}

export function recordMediaState(
	tabId: number,
	documentId: string,
	payload: {
		hasMediaElement: boolean;
		userInteracted: boolean;
		reportRevision?: number;
		hasSubframes?: boolean;
	},
): { reported: true } {
	// v2 legacy producers have no ordering token. Accept the additive wire shape,
	// but never let an unordered report create or replace a current media fact.
	const ordering = classifyMediaReport(payload);
	if (ordering.status === 'legacy-unversioned') return { reported: true };
	const state = getOrCreateTabAudioState(tabId, documentId);
	if (ordering.revision <= state.reportRevision) return { reported: true };
	state.hasMediaElement = payload.hasMediaElement;
	state.reportRevision = ordering.revision;
	// The content script report is the authoritative source: solidify the media
	// fact immediately (auto-corrects media removal/loading).
	//
	// EXCEPTION: a top-level no-media report on a page that hosts subframes is
	// inconclusive — the media may live in a same- or cross-origin frame that
	// the isolated-world reporter cannot read. Solidifying that would durably
	// hide nested media: the all-frames probe is skipped for current facts, so
	// the tab would never be re-examined. Leave such tabs probeable instead.
	if (!payload.hasMediaElement && payload.hasSubframes === true) {
		/* @__PURE__ */ swLog.debug(`[SPECTRA] Tab ${tabId} top frame reports no media but hosts subframes; probe will arbitrate`);
		return { reported: true };
	}
	mediaFacts.rememberMediaFact(tabId, documentId, payload.hasMediaElement ? 'found' : 'no-media', 'report');

	/* @__PURE__ */ swLog.debug(`[SPECTRA] Tab ${tabId} reported media: ${payload.hasMediaElement}`);
	return { reported: true };
}

function isRecent(timestamp: number, now: number): boolean {
	return timestamp > 0 && now >= timestamp && now - timestamp < TAB_VISIBLE_THRESHOLD_MS;
}

async function hasNativeMedia(tabId: number, generation: number): Promise<MediaProbeResult> {
	type FrameResult = { frameId: number; documentId?: string; url?: string };
	let before: FrameResult[];
	try { before = await chrome.webNavigation.getAllFrames({ tabId }) as unknown as FrameResult[] ?? []; }
	catch { return { outcome: 'unknown', documentId: null }; }
	const top = before.find((frame) => frame.frameId === 0);
	if (!top?.documentId || generation !== tabDocumentGeneration(tabId)) {
		return { outcome: 'stale', documentId: top?.documentId ?? null };
	}
	let execution: chrome.scripting.InjectionResult[];
	try {
		execution = await chrome.scripting.executeScript({
			target: { tabId, allFrames: true },
			func: () => document.querySelector('video,audio') !== null,
		});
	} catch {
		return { outcome: 'denied', documentId: top.documentId };
	}
	let after: FrameResult[];
	try { after = await chrome.webNavigation.getAllFrames({ tabId }) as unknown as FrameResult[] ?? []; }
	catch { return { outcome: 'unknown', documentId: top.documentId }; }
	if (generation !== tabDocumentGeneration(tabId)) return { outcome: 'stale', documentId: top.documentId };
	const identity = (frame: Pick<FrameResult, 'frameId' | 'documentId'>) => (
		`${frame.frameId}:${frame.documentId ?? ''}`
	);
	const beforeIds = new Set(before.map(identity));
	const afterIds = new Set(after.map(identity));
	if (beforeIds.size !== afterIds.size || [...beforeIds].some((value) => !afterIds.has(value))) {
		return { outcome: 'stale', documentId: top.documentId };
	}
	const observed = new Set(execution
		.filter((result) => typeof result.documentId === 'string')
		.map((result) => `${result.frameId}:${result.documentId ?? ''}`));
	if (execution.some((result) => result.result === true)) return { outcome: 'found', documentId: top.documentId };
	if ([...beforeIds].some((value) => !observed.has(value))) return { outcome: 'denied', documentId: top.documentId };
	if (execution.every((result) => result.result === false)) return { outcome: 'no-media', documentId: top.documentId };
	return { outcome: 'unknown', documentId: top.documentId };
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
	documentGeneration: tabDocumentGeneration,
	probe: hasNativeMedia,
	readFact: mediaFacts.readMediaFact,
	isFactCurrent: mediaFacts.isFactCurrent,
	rememberFact: mediaFacts.rememberMediaFact,
	readCooldown: mediaFacts.readCooldown,
	rememberCooldown: mediaFacts.rememberCooldown,
	forgetCooldown: mediaFacts.forgetCooldown,
});

function registerTabStateV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| (candidate.type !== 'spectra.tab.media.report'
				&& candidate.type !== 'spectra.tab.visible.list'
				&& candidate.type !== 'spectra.tab.visible.settle'
				&& candidate.type !== 'spectra.content.inject')) return false;
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Tab-state RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed tab-state request'));
			return false;
		}

		const operation = async () => {
			if (message.type === 'spectra.tab.media.report') {
				const tabId = sender.tab?.id;
				if (!tabId || (message.tabId !== undefined && message.tabId !== tabId)) {
					throw new Error('Media report requires its content-script tab');
				}
				if (sender.frameId !== 0 || !sender.documentId
					|| await currentTopDocumentId(tabId) !== sender.documentId) {
					throw new Error('Media report belongs to a stale or non-top-level document');
				}
				return recordMediaState(tabId, sender.documentId, message.payload);
			}
			if (message.type === 'spectra.content.inject') {
				return { injected: await injectContentScriptOnDemand(message.payload.tabId) };
			}
			if (message.type === 'spectra.tab.visible.list') {
				// Hydrate facts from the session area (memoized) before reading the
				// inventory. The read is a non-blocking projection of solidified facts
				// and live seeds: a popup open never waits for chrome.scripting probes.
				// The probe sweep is scheduled in the background and converges facts,
				// so the next read reflects newly discovered media.
				await mediaFacts.ready();
				const inventory = await resolveVisibleTabs.readNow();
				void resolveVisibleTabs().catch((error: unknown) => {
					/* @__PURE__ */ swLog.debug('[TabState] Background media sweep failed', error);
				});
				return inventory;
			}
			if (message.type === 'spectra.tab.visible.settle') {
				// Convergence read: await the in-flight sweep (single-flight, bounded by
				// the scan budget) so the popup can re-render with newly probed media
				// tabs instead of asking the user to reopen. Falls back to the instant
				// projection when the sweep itself fails.
				await mediaFacts.ready();
				try {
					await resolveVisibleTabs();
				} catch (error) {
					/* @__PURE__ */ swLog.debug('[TabState] Inventory convergence sweep failed', error);
				}
				return resolveVisibleTabs.readNow();
			}
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
