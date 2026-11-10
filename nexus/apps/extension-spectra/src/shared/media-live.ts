// goal: one definition of "this media element is a live presentation", shared
// by every reader that must behave differently on a live stream
//
// The primary fact is the one the element cannot fake: an unbounded duration.
// A media resource that has no end reports `Infinity` once its metadata is
// known, and no on-demand resource does. Measured on Huya, Bilibili Live and
// Douyin Live, where the playback element always reported `Infinity` while
// every finite clip on the same page (pre-roll, cover, highlight) reported a
// real duration.
//
// `Infinity` alone is nevertheless not enough. A resource that delivers no
// media — a truncated or zero-sample file, a stub element a test harness gave a
// 44-byte WAV — also reports `Infinity`, and it still accepts and keeps a rate.
// Calling that "live" removes a control the page honours. The element must also
// be presenting something: a buffered range, or a `MediaStream` that has no
// ranges by definition. A live presentation that has buffered nothing yet is
// reported as on-demand; the window before any data arrives is also the window
// in which no rate can be observed, so the cost is one readback, not a control
// that never works.
//
// Two weaker signals are deliberately rejected:
//
// - `duration` still `NaN` after metadata. That is "no answer yet", not "no
//   end"; treating it as live disabled speed on ordinary videos whose metadata
//   had not settled.
// - A `seekable` window whose start advances. A DVR stream does that, but so
//   does an MSE on-demand buffer that has begun evicting its oldest range, and
//   the two are not distinguishable from the range alone. A false positive here
//   removes a control the page does support, so it is not worth the guess.
//
// Playback state is also not part of the decision. A paused broadcast is still
// a broadcast; tying the fact to `paused` let a paused live element accept a
// speed it could never honour.

/**
 * True when the element presents a live stream rather than a finite timeline.
 *
 * Deliberately conservative: `false` means "unknown or on-demand", never
 * "probably live". The write path uses this to refuse a field the presentation
 * cannot honour, so a wrong `true` removes a working control while a wrong
 * `false` only produces the readback failure that was already observable.
 */
export function isLiveMedia(element: HTMLMediaElement): boolean {
	if (element.duration !== Number.POSITIVE_INFINITY) return false;
	// `buffered` is a `TimeRanges` on every element the browser hands us, but this
	// runs on whatever the document presents — a page can replace the property,
	// and an admission filter that throws here would take the whole selection
	// path down with it. Evidence that cannot be read is not evidence.
	const buffered = element.buffered as TimeRanges | undefined;
	if ((buffered?.length ?? 0) > 0) return true;
	// Duck-typed on purpose: this runs in an isolated world, and a `MediaStream`
	// created by the page realm does not satisfy this realm's `instanceof`.
	const attached = element.srcObject as { getTracks?: unknown } | null;
	return Boolean(attached && typeof attached.getTracks === 'function');
}

/**
 * The fields a live presentation cannot honour.
 *
 * Speed is a timeline transform: a live stream has no timeline to transform, so
 * the native setter is accepted by the element and then reverted by the player
 * (or silently applied to a buffer that is about to be discarded), which reads
 * back as a mismatch after the fact. Refusing before the write is the only
 * honest answer.
 */
export function isLiveUnsupportedField(field: string): boolean {
	return field === 'speed';
}
