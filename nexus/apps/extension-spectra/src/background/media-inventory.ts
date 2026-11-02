// goal: project the media-tab inventory from the claims each tab made about itself
// inv: a tab is listed because Chrome says it is audible, or because its own
//      current document reported playable media - never because the background
//      injected code into a tab to find out
//
// Why this is a projection and not a scan
// ---------------------------------------
// The inventory used to answer "which tabs hold media?" by injecting a probe into
// every controllable tab and asking whether the DOM contained a `<video>` or
// `<audio>` element. That question cannot be answered that way:
//
//   * it is a write, not a read. Injecting into a background tab forces Chrome to
//     schedule a renderer task in a page that may still be committing, may be
//     throttled, or may never finish loading. A tab the user has not opened is
//     not ours to wake;
//   * the answer is wrong in both directions. Element presence is markup, not
//     playback: player shells, ad slots and `preload="none"` templates match
//     while hosting nothing, and media in a frame the probe cannot reach is
//     missed anyway;
//   * it is slow by construction. One settled answer per tab, bounded by a scan
//     budget, so the list could only be completed seconds after the Popup opened
//     - and the cards it discovered appeared as a batch, long after the user had
//     already read an empty list;
//   * every failure (denied/stale/unknown/timeout) became a user-visible
//     "still verifying" state that no user action could resolve.
//
// A tab is the only authority on what its own document is playing. It says so in
// two ways that cost nothing to read: Chrome's `audible` flag, and the media
// report its own content script sends at document start and on every media
// lifecycle event (shared/media-presence.ts decides what counts). Both are
// statements about a document that exists, so a tab that never loaded cannot
// make one, and there is nothing left to be "pending": the list is complete the
// moment it is read.

import type { SpectraResponseData } from '@nexus/contracts';
import type { MediaFact } from './media-facts';
import { projectMediaCardMembership } from '../shared/media-card-policy';
import { DEFAULT_GLOBAL_SETTINGS } from '@nexus/contracts';

export interface MediaInventoryDependencies {
	queryTabs(): Promise<chrome.tabs.Tab[]>;
	/** Chrome's own audible set, mirrored into tab bookkeeping as a side effect. */
	audibleTabs(tabs: readonly chrome.tabs.Tab[], now: number): Set<number>;
	/** Durable verdict the tab's own current document reported. */
	readFact(tabId: number): MediaFact | null;
	readPauseRetention?(): Promise<number>;
}

// The inventory answers the `spectra.tab.visible.list` request with exactly the
// wire shape that request is contracted to return; it declares no second shape
// of its own, so the list cannot drift from what the Popup validates.
export type ReadMediaTabInventory = (
	now?: number,
) => Promise<SpectraResponseData<'spectra.tab.visible.list'>>;

// A card is only useful if the Popup could act on it: a real http(s)/file
// document in a live renderer. Extension-internal, restricted and discarded pages
// cannot host controllable media, so they are out of scope rather than "unknown".
//
// Document status is deliberately not part of this: a tab whose load event never
// fires can still be playing (that is what long-lived subresources look like), and
// a tab that has not committed cannot have reported playable media in the first
// place. The claim is the proof; re-checking a load flag on top of it would only
// re-introduce a state we would then have to explain to the user.
export function createMediaTabInventory(
	dependencies: MediaInventoryDependencies,
): ReadMediaTabInventory {
	return async (now = Date.now()) => {
		const [tabs, retention] = await Promise.all([
			dependencies.queryTabs(),
			dependencies.readPauseRetention?.() ?? Promise.resolve(DEFAULT_GLOBAL_SETTINGS.pauseRetentionSeconds),
		]);
		dependencies.audibleTabs(tabs, now);
		const membership = projectMediaCardMembership(tabs, dependencies.readFact, retention, now);
		return { tabs: membership.tabs,
			...(membership.inactiveTabs.length > 0 ? { inactiveTabs: membership.inactiveTabs } : {}),
			...(membership.nextExpiryAt === undefined ? {} : { nextExpiryAt: membership.nextExpiryAt, expiryByTab: membership.expiryByTab }) };
	};
}
