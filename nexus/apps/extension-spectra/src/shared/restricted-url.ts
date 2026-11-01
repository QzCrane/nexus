// goal: one predicate for "this document cannot host a card"
// inv: a URL scheme is either controllable or it is not - never "probably"
//
// Both surfaces need the same answer for different reasons. The Popup uses it to
// decide whether the active tab gets a card at all, and the Background uses it to
// count the cards that Popup is about to draw, because that count is what the
// Action Popup URL announces before the Popup exists. Two copies of this list
// would let the announcement disagree with the window it sizes.

export const RESTRICTED_URL_PREFIXES = [
	'chrome:',
	'edge:',
	'about:',
	'chrome-extension:',
] as const;

// rule: identifies browser-internal or restricted URLs (e.g. chrome://, edge://) where extensions are disabled
export function isRestrictedUrl(url: string | undefined): boolean {
	if (!url) return true;
	return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
