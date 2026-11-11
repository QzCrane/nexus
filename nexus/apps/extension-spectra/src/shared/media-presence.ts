// goal: one definition of "this document holds media a user could control"
// inv: a source assignment is media; only a bare markup shell is not
//
// The inventory used to answer this question with `querySelector('video,audio')
// !== null`. That is a statement about markup, not about playback: ad frames,
// template placeholders and every SPA that renders a player shell before it
// fills it all match, while hosting nothing the user can act on.
//
// Playback was then used as the admission test, which failed in the opposite
// direction. A live route attaches its broadcast (a MediaStream) or a blob
// source and can keep the element at HAVE_NOTHING until the viewer's first
// gesture; an SPA can insert a configured player while metadata is still in
// flight. Those elements are already the native surface the volume control
// addresses, and the observation runtime has to exist before that gesture, not
// after playback proves itself. A shell with no resource at all still counts
// as nothing.
//
// HAVE_METADATA means the element selected a resource and decoded its metadata:
// there is a duration (or a live stream), a target the controls can address, and
// a real media timeline. `currentTime`/`played` keep a paused element admitted
// after a source swap tears its readyState back down.
// HAVE_METADATA is 1 in the HTML spec. The numeric form keeps this module usable
// outside a DOM (unit fixtures, the service worker), where the HTMLMediaElement
// constructor does not exist but the numeric `readyState` contract still holds.
const HAVE_METADATA = 1;

export function hasMediaSurface(root: ParentNode): boolean {
	for (const media of root.querySelectorAll<HTMLMediaElement>('video,audio')) {
		if (media.readyState >= HAVE_METADATA) return true;
		if (media.currentTime > 0) return true;
		// `played` is the only evidence left after a source swap resets readyState;
		// it is read defensively because a media-shaped stub need not implement it.
		if ((media.played?.length ?? 0) > 0) return true;
		// A live route attaches the broadcast as a MediaStream and can park the
		// element at `HAVE_NOTHING` until the first gesture. The tracks are already
		// real media the controls address.
		if ((media.srcObject as { getTracks?: () => unknown[] } | null)?.getTracks?.().length) return true;
		// Any selected resource is a configured player: `blob:`/MSE live sources and
		// `preload="none"` players alike. A markup shell has none.
		if (media.currentSrc || media.src) return true;
	}
	return false;
}
