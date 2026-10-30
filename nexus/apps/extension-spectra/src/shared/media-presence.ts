// goal: one definition of "this document holds media a user could control"
// inv: an element is a slot, not media; only a source that actually loaded counts
//
// The inventory used to answer this question with `querySelector('video,audio')
// !== null`. That is a statement about markup, not about playback: ad frames,
// template placeholders, `preload="none"` players and every SPA that renders a
// player shell before it fills it all match, while hosting nothing the user can
// act on. A tab that is still loading - which is exactly the tab that must never
// become a card - is the most likely to be in that state.
//
// HAVE_METADATA means the element selected a resource and decoded its metadata:
// there is a duration (or a live stream), a target the controls can address, and
// a real media timeline. `currentTime`/`played` keep a paused element admitted
// after a source swap tears its readyState back down. A shell that never loaded
// anything has none of the three, and no amount of waiting changes that.
// HAVE_METADATA is 1 in the HTML spec. The numeric form keeps this module usable
// outside a DOM (unit fixtures, the service worker), where the HTMLMediaElement
// constructor does not exist but the numeric `readyState` contract still holds.
const HAVE_METADATA = 1;

export function hasPlayableMedia(root: ParentNode): boolean {
	for (const media of root.querySelectorAll<HTMLMediaElement>('video,audio')) {
		if (media.readyState >= HAVE_METADATA) return true;
		if (media.currentTime > 0) return true;
		// `played` is the only evidence left after a source swap resets readyState;
		// it is read defensively because a media-shaped stub need not implement it.
		if ((media.played?.length ?? 0) > 0) return true;
	}
	return false;
}
