// goal: single owner deciding whether a Runtime-origin control RPC may assert its claimed source
import type { ControlIntentSource, MediaTarget } from '@nexus/contracts';

// post: everything the authorization boundary needs, with browser-derived
// evidence resolved by the caller so this owner stays free of Chrome effects
export interface RuntimeControlClaim {
	readonly sender: chrome.runtime.MessageSender;
	readonly tabId: number;
	readonly source: ControlIntentSource;
	readonly target: MediaTarget | null;
	readonly popupSender: boolean;
	readonly hotkeySender: boolean;
}

export interface ControlSourceRejection {
	readonly code: 'forbidden';
	readonly message: string;
}

// post: null means the claim is admissible; otherwise the sender may not assert it
export function authorizeRuntimeControl(claim: RuntimeControlClaim): ControlSourceRejection | null {
	const { sender, tabId, source, target } = claim;
	if (source === 'remote' || source === 'system') {
		return {
			code: 'forbidden',
			message: 'Background-only control sources cannot be asserted by runtime RPC',
		};
	}
	if (source === 'restore' && (
		sender.tab?.id !== tabId
		|| sender.frameId !== 0
		|| !sender.documentId
		|| target === null
		|| target.documentId !== sender.documentId
	)) {
		return {
			code: 'forbidden',
			message: 'Restore control must match its exact top-level document sender',
		};
	}
	if (source === 'page' && (
		sender.tab?.id !== tabId
		|| sender.frameId !== 0
		|| !sender.documentId
		|| target !== null && target.documentId !== sender.documentId
	)) {
		return {
			code: 'forbidden',
			message: 'Page observation identity does not match its top-level sender',
		};
	}
	if ((source === 'popup' && !claim.popupSender)
		|| (source === 'hotkey' && !claim.hotkeySender)) {
		return {
			code: 'forbidden',
			message: 'Extension-invoked control requires a trusted Popup or top-level hotkey document',
		};
	}
	return null;
}
