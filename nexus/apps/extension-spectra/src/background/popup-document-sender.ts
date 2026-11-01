// goal: recognise one of this extension's own documents from a browser-owned sender
//
// The Action Popup is not always the bare `popup.html` the manifest names. The
// Background states how many cards the Popup will draw in the Popup's *own* URL
// (`chrome.action.setPopup`, see `popup-frame.ts`), so the document Chrome opens
// is `popup.html?cards=2` and every request that document makes reports exactly
// that string back in `sender.url`.
//
// Trust therefore has to be a statement about *which document* a sender is, not
// about the literal bytes of its URL: same extension, same origin, same path.
// Comparing whole URLs against the bare path rejected the one surface these
// checks exist to trust, and did it only when the card count was known — which is
// the ordinary case, not the edge one.

import { ACTION_POPUP_PATH } from '../shared/popup-bootstrap';

/** The parts of `chrome.runtime.MessageSender` this decision depends on. */
export interface ExtensionDocumentSender {
	readonly id?: string | undefined;
	readonly url?: string | undefined;
	readonly tab?: { readonly id?: number } | undefined;
}

function ownExtensionId(): string | null {
	try {
		return chrome.runtime.id;
	} catch {
		// No extension runtime: nothing can be one of its documents.
		return null;
	}
}

/**
 * post: whether `sender` is a document of this extension at `path`
 *
 * The query and fragment are accepted because the extension is the only party
 * that can append them — a page cannot navigate an extension document, and a
 * content script reports the *page's* URL, which fails the origin test.
 */
export function isExtensionDocumentSender(
	sender: ExtensionDocumentSender | null | undefined,
	path: string,
): boolean {
	if (!sender) return false;
	const extensionId = ownExtensionId();
	if (extensionId === null || sender.id !== extensionId) return false;
	if (typeof sender.url !== 'string') return false;
	let url: URL;
	try {
		url = new URL(sender.url);
	} catch {
		return false;
	}
	return url.protocol === 'chrome-extension:'
		&& url.host === extensionId
		&& url.pathname === `/${path}`;
}

/**
 * post: whether `sender` is a document of this extension's Popup, in any surface
 *
 * For decisions a document makes about itself — its own settings, its own route
 * rules — the Popup opened as a tab is the same document and the same authority.
 */
export function isPopupDocumentSender(sender: ExtensionDocumentSender | null | undefined): boolean {
	return isExtensionDocumentSender(sender, ACTION_POPUP_PATH);
}

/**
 * post: whether `sender` is the Action Popup surface itself
 *
 * A sender with no owning tab is a document the browser opened for this
 * extension; `isPopupDocumentSender` has already pinned it to the Popup path, so
 * no content script can answer yes — a content script always carries its tab.
 */
export function isActionPopupSender(sender: ExtensionDocumentSender | null | undefined): boolean {
	return sender?.tab === undefined && isPopupDocumentSender(sender);
}
