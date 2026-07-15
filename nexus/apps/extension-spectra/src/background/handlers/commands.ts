// goal: provide one validated owner for tab and extension-view hotkey commands

import {
	Actions,
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	rpcFailure,
	rpcSuccess,
} from '@nexus/contracts';
import { router } from '../state';

async function togglePinned(tabId: number): Promise<{ pinned: boolean }> {
	const tab = await chrome.tabs.get(tabId);
	const updated = await chrome.tabs.update(tabId, { pinned: !tab.pinned });
	if (!updated) throw new Error('Tab disappeared while toggling its pinned state');
	return { pinned: updated.pinned };
}

async function toggleMuted(tabId: number): Promise<{ muted: boolean }> {
	const tab = await chrome.tabs.get(tabId);
	const muted = tab.mutedInfo?.muted === true;
	const updated = await chrome.tabs.update(tabId, { muted: !muted });
	if (!updated) throw new Error('Tab disappeared while toggling its muted state');
	return { muted: updated.mutedInfo?.muted === true };
}

async function openView(view: 'options' | 'popup'): Promise<{ opened: true }> {
	if (view === 'options') {
		await chrome.runtime.openOptionsPage();
	} else {
		await chrome.action.openPopup();
	}
	return { opened: true };
}

function registerCommandsV2Listener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| typeof candidate.type !== 'string'
			|| (!candidate.type.startsWith('spectra.tab.') && candidate.type !== 'spectra.ui.open')) return false;
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Command RPC is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)
			|| (message.type !== 'spectra.tab.pinned.toggle'
				&& message.type !== 'spectra.tab.muted.toggle'
				&& message.type !== 'spectra.ui.open')) {
			sendResponse(rpcFailure('invalid_request', 'Malformed extension command'));
			return false;
		}

		const operation = async () => {
			if (message.type === 'spectra.ui.open') return openView(message.payload.view);
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

	// note: one-release v1 adapters delegate to the same implementation
	router.on(Actions.TAB_PIN, async (_, sender) => {
		if (!sender.tab?.id) throw new Error('Tab pin requires a content-script tab');
		return togglePinned(sender.tab.id);
	});
	router.on(Actions.TAB_MUTE, async (_, sender) => {
		if (!sender.tab?.id) throw new Error('Tab mute requires a content-script tab');
		return toggleMuted(sender.tab.id);
	});
	router.on(Actions.OPEN_OPTIONS, () => openView('options'));
	router.on(Actions.OPEN_POPUP, () => openView('popup'));
}
