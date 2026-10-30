// goal: project the visible media-tab list from durable facts plus Chrome's own
// audible flag, without a background round trip
//
// The background inventory answers `spectra.tab.visible.list` from the same two
// sources: a tab is listed because Chrome says it is audible, or because its own
// current document reported playable media into the durable fact store. Both are
// already persisted - the audible flag rides on chrome.tabs, and the verdicts
// live in chrome.storage.local under `spectra.media-facts.v1`. Reading them here
// removes the service-worker wake that dominated the Popup's first paint, so the
// cards can render the moment the tab list lands instead of one round trip later.
//
// A null result means the storage read failed; the caller falls back to the
// background RPC. The RPC remains the authority that reconciles any difference
// (a fact flushed moments ago, a tab that navigated in between), so this path is
// a forecast, never a second source of truth.

const MEDIA_FACTS_KEY = 'spectra.media-facts.v1';

interface StoredMediaFact {
	documentId?: string;
	outcome?: 'found' | 'no-media';
	at?: number;
	source?: string;
}

// A card is only useful if the Popup could act on it: a real http(s)/file
// document in a live renderer. This mirrors the background's own controllability
// fence so the fast path and the RPC can never disagree about scope.
function controllable(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
	if (!Number.isSafeInteger(tab.id) || Number(tab.id) <= 0 || !tab.url) return false;
	if (tab.discarded === true) return false;
	try {
		return ['http:', 'https:', 'file:'].includes(new URL(tab.url).protocol);
	} catch {
		return false;
	}
}

// post: returns the sorted media-tab ids, or null when the durable facts cannot
// be read and the caller must use the background RPC instead
export async function readVisibleMediaTabIdsFromStorage(
	allTabs: readonly chrome.tabs.Tab[],
): Promise<number[] | null> {
	let facts: Record<string, StoredMediaFact> | undefined;
	try {
		if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
		const stored = (await chrome.storage.local.get(MEDIA_FACTS_KEY)) as Record<string, unknown>;
		facts = stored[MEDIA_FACTS_KEY] as Record<string, StoredMediaFact> | undefined;
	} catch {
		return null;
	}
	const visible: number[] = [];
	for (const tab of allTabs) {
		if (!controllable(tab)) continue;
		if (tab.audible === true) {
			visible.push(tab.id);
			continue;
		}
		if (facts?.[String(tab.id)]?.outcome === 'found') visible.push(tab.id);
	}
	return visible.sort((left, right) => left - right);
}
