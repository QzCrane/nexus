// goal: provide one validated owner for tab and extension-view hotkey commands

import {
	rpcFailure,
	rpcSuccess,
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { submitControlRequest } from '../control-coordinator';
import { isBackgroundRequestEnvelope, RPC_INVALID_REQUEST } from '../background-rpc';

const COMMAND_REQUEST_TYPES: ReadonlySet<string> = new Set([
	'spectra.tab.pinned.toggle',
	'spectra.tab.muted.toggle',
	'spectra.ui.open',
] as const);

async function togglePinned(tabId: number): Promise<{ pinned: boolean }> {
	const ack = await submitControlRequest({
		tabId,
		source: 'hotkey',
		requestedCoverage: 'full',
		target: null,
		mutations: [{ field: 'tabPinned', operation: 'toggle' }],
	});
	const pinned = ack.fields.tabPinned?.actual;
	if (typeof pinned !== 'boolean') throw new Error('Tab pin did not return an actual state');
	return { pinned };
}

async function toggleMuted(tabId: number): Promise<{ muted: boolean }> {
	const ack = await submitControlRequest({
		tabId,
		source: 'hotkey',
		requestedCoverage: 'full',
		target: null,
		mutations: [{ field: 'tabMuted', operation: 'toggle' }],
	});
	const muted = ack.fields.tabMuted?.actual;
	if (typeof muted !== 'boolean') throw new Error('Tab mute did not return an actual state');
	return { muted };
}

async function openView(view: 'options' | 'popup', windowId?: number): Promise<{ opened: true }> {
	if (view === 'options') {
		await chrome.runtime.openOptionsPage();
	} else {
		await chrome.action.openPopup(windowId === undefined ? {} : { windowId });
	}
	return { opened: true };
}

function registerCommandsV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| typeof candidate.type !== 'string'
			|| !COMMAND_REQUEST_TYPES.has(candidate.type)) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Command RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed extension command'));
			return false;
		}

		const operation = async () => {
			if (message.type === 'spectra.ui.open') return openView(message.payload.view, sender.tab?.windowId);
			const tabId = sender.tab?.id;
			if (!tabId || (message.tabId !== undefined && message.tabId !== tabId)) {
				throw new Error('Tab command requires its content-script tab');
			}
			return message.type === 'spectra.tab.pinned.toggle'
				? togglePinned(tabId)
				: toggleMuted(tabId);
		};

		void operation()
			.then((result) => sendResponse(rpcSuccess(result)))
			.catch((error) => sendResponse(rpcFailure(
				'command_failed',
				error instanceof Error ? error.message : String(error),
				true,
			)));
		return true;
	});
}

export function registerCommandHandlers(): void {
	registerCommandsV2Listener();
}
