// goal: the single definition of extension invocation identity and its document binding

import { createSpectraContentInvocationGrantedMessage } from '@nexus/contracts';

export interface ExtensionDocumentIdentity {
	tabId: number;
	documentId: string;
}

export interface ExtensionInvocationContext {
	origin: 'popup' | 'builtin-page' | 'site-page' | 'chrome-command';
	foreground: ExtensionDocumentIdentity | null;
	target: ExtensionDocumentIdentity;
}

export function sameExtensionDocument(
	left: ExtensionDocumentIdentity | null,
	right: ExtensionDocumentIdentity,
): boolean {
	return left?.tabId === right.tabId && left.documentId === right.documentId;
}

export async function assertInvocationTargetCurrent(
	tabId: number,
	invocation: ExtensionInvocationContext,
): Promise<void> {
	if (invocation.target.tabId !== tabId) {
		throw new Error('Extension invocation target tab does not match the control request');
	}
	const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
	if (frame?.documentId !== invocation.target.documentId) {
		throw new Error('Extension invocation belongs to a stale target document');
	}
}

/**
 * Publish an invocation grant to exactly the invoked document. Chrome's
 * `activeTab` survives until that document navigates, so the document-start
 * hotkey gate must stop treating Alt+Up as needing a fresh manifest command
 * even after the Capture session it started has ended.
 */
export function grantContentInvocation(tabId: number, documentId: string): void {
	void chrome.tabs.sendMessage(
		tabId,
		createSpectraContentInvocationGrantedMessage(),
		{ documentId },
	).catch(() => undefined);
}

export async function popupInvocation(tabId: number): Promise<ExtensionInvocationContext> {
	const [frame, tabs] = await Promise.all([
		chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
		chrome.tabs.query({ active: true, currentWindow: true }),
	]);
	if (!frame?.documentId) throw new Error('Popup target has no current document');
	const target = { tabId, documentId: frame.documentId };
	return {
		origin: 'popup',
		foreground: tabs[0]?.id === tabId ? target : null,
		target,
	};
}

export function assertPopupRequestDocument(
	invocation: ExtensionInvocationContext,
	requestedDocumentId?: string,
): void {
	if (requestedDocumentId !== undefined
		&& invocation.target.documentId !== requestedDocumentId) {
		throw new Error('Popup control belongs to a stale document');
	}
}
