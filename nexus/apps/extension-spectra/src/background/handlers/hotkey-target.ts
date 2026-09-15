// goal: exposes the background-owned hotkey target through validated v2 RPC

import {
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { hotkeyTargetRepository } from '../hotkey-target-repository';
import { isBackgroundRequestEnvelope, rpcFailure, rpcSuccess , RPC_INVALID_REQUEST} from '../background-rpc';

const HOTKEY_TARGET_REQUEST_TYPES = new Set([
	'spectra.hotkey-target.get',
	'spectra.hotkey-target.set',
]);

function isAttemptedHotkeyTargetMessage(message: unknown): boolean {
	if (!message || typeof message !== 'object') return false;
	const candidate = message as { protocolVersion?: unknown; type?: unknown };
	return candidate.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& typeof candidate.type === 'string'
		&& HOTKEY_TARGET_REQUEST_TYPES.has(candidate.type);
}

export function registerHotkeyTargetHandlers(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!isAttemptedHotkeyTargetMessage(message)) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Hotkey target RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed SPECTRA hotkey target request'));
			return false;
		}

		const operation = async () => {
			if (message.type === 'spectra.hotkey-target.get') {
				return hotkeyTargetRepository.get();
			}
			if (message.type === 'spectra.hotkey-target.set') {
				return hotkeyTargetRepository.set(message.payload.tabId);
			}
			throw new Error('Unsupported hotkey target request');
		};
		void operation()
			.then((state) => sendResponse(rpcSuccess(state)))
			.catch((error) => sendResponse(rpcFailure(
				'hotkey_target_unavailable',
				error instanceof Error ? error.message : String(error),
				true,
			)));
		return true;
	});
}
