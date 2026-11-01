// goal: one live instance of the media-tab inventory, shared by every reader
// inv: the projection is stateless between reads - it is a statement about what
//      the tabs are doing now, never a cache of what they were doing
//
// The inventory used to be constructed inside the tab-state RPC handler, which
// made it a private detail of one request. It is not: the Popup needs the same
// list to decide how many cards it will draw, and the Action Popup URL has to
// carry that count before the Popup exists. Two constructions would be two
// definitions of "a media tab", and the announcement would drift from the list
// it announces.

import { createMediaTabInventory, type ReadMediaTabInventory } from './media-inventory';
import { mediaFacts } from './media-facts';
import { tabAudioStates, TAB_VISIBLE_THRESHOLD_MS } from './state';

function isRecent(timestamp: number, now: number): boolean {
	return timestamp > 0 && now >= timestamp && now - timestamp < TAB_VISIBLE_THRESHOLD_MS;
}

// The inventory is a statement about what a tab is doing now, so it is seeded
// from Chrome's own audible flag and from the content document's report - never
// from how recently the tab happened to make noise. Recency only prunes the
// audio bookkeeping that other surfaces read; it never puts a tab in the list,
// because a tab that navigated to a blank page stays "recently audible" for
// minutes while hosting nothing the user can control.
function audibleTabs(allTabs: readonly chrome.tabs.Tab[], now: number): Set<number> {
	const audible = new Set<number>();
	const liveTabIds = new Set<number>();
	for (const tab of allTabs) {
		if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0) continue;
		const tabId = Number(tab.id);
		liveTabIds.add(tabId);
		if (tab.audible) audible.add(tabId);
	}
	for (const [tabId, state] of tabAudioStates) {
		if (!liveTabIds.has(tabId)) { tabAudioStates.delete(tabId); continue; }
		if (audible.has(tabId)) continue;
		if (!isRecent(state.lastAudibleTime, now) && !isRecent(state.lastActivatedTime, now)) {
			tabAudioStates.delete(tabId);
		}
	}
	return audible;
}

export const readMediaTabInventory: ReadMediaTabInventory = createMediaTabInventory({
	queryTabs: () => chrome.tabs.query({}),
	audibleTabs,
	readFact: mediaFacts.readMediaFact,
});
