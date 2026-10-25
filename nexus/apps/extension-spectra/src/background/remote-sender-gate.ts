// goal: the single owner of "may this extension document read remote session state"
//
// This is a transport-trust decision, not session state: it answers who is calling,
// never what the session contains. Keeping it separate means the session owner can
// evolve without re-litigating the caller gate.

/**
 * Extension documents that legitimately read remote session state.
 *
 * An origin-prefix match is deliberately not used: a prefix admits every
 * same-origin document, including future ones added for unrelated reasons. A
 * missing `sender.url` used to be admitted as well, which meant the gate
 * described the transport instead of the caller.
 */
const TRUSTED_UI_DOCUMENTS: ReadonlySet<string> = new Set(['popup.html', 'options.html']);

export function isTrustedExtensionUi(sender: chrome.runtime.MessageSender): boolean {
	if (sender.id !== chrome.runtime.id) return false;
	if (sender.tab) return false;
	if (!sender.url) return false;
	let documentPath: string;
	try {
		const parsed = new URL(sender.url);
		if (parsed.protocol !== 'chrome-extension:') return false;
		documentPath = parsed.pathname.replace(/^\//u, '');
	} catch {
		return false;
	}
	return TRUSTED_UI_DOCUMENTS.has(documentPath);
}
