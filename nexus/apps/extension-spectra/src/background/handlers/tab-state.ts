// goal: manages tab-specific audio activity and visibility states to prioritize the UI tab list

import { getOrCreateTabAudioState } from '../state';
import { injectContentScriptOnDemand } from '../upgrade-manager';
import { swLog } from '../../shared/logger';
import {
	rpcFailure,
	rpcSuccess,
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { readMediaTabInventory } from '../media-inventory-runtime';
import { syncActiveActionPopups } from '../popup-frame';
import { mediaFacts } from '../media-facts';
import { currentTopDocumentId } from '../../shared/top-document';
import { isBackgroundRequestEnvelope, RPC_INVALID_REQUEST } from '../background-rpc';

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
	// The content script report is the authority for its own document: it is the
	// same document that produced it, and it re-sends on every media lifecycle
	// event, so solidifying it immediately is what keeps the inventory equal to
	// what the tab is doing. A no-media report is as conclusive as a found one -
	// media nested in a frame this world cannot read is not controllable from the
	// Popup either, so pretending the tab is "still unknown" would only preserve
	// a card whose controls cannot reach the player.
	mediaFacts.rememberMediaFact(tabId, documentId, payload.hasMediaElement ? 'found' : 'no-media', 'report');

	// The media tabs are what the Popup draws cards for, and the Action Popup
	// URL states how many of them it will draw before the Popup exists. A report
	// can add or remove a card on a tab that is already active, so the count has
	// to be re-announced here - tab activation alone would leave the next open
	// reserving the previous shape's height.
	syncActiveActionPopups();

	/* @__PURE__ */ swLog.debug(`[SPECTRA] Tab ${tabId} reported media: ${payload.hasMediaElement}`);
	return { reported: true };
}

function registerTabStateV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| (candidate.type !== 'spectra.tab.media.report'
				&& candidate.type !== 'spectra.tab.visible.list'
				&& candidate.type !== 'spectra.content.inject')) return false;
		if (sender.id !== chrome.runtime.id) {
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
				// Hydrate the durable verdicts once (memoized) and project them. There
				// is nothing to wait for: every tab that holds media has already said
				// so, and a tab that has not said so is not a media tab yet.
				await mediaFacts.ready();
				return readMediaTabInventory();
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
