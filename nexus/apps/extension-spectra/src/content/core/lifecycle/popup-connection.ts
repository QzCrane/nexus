// goal: own the one live Popup observation lease without audio side effects

import type { PolicyExecutorState } from '../../types';

export function setupPopupConnectionListener(state: PolicyExecutorState): () => void {
	if (typeof chrome === 'undefined' || !chrome.runtime?.onConnect) return () => undefined;

	const disconnectors = new Set<() => void>();
	const listener = (port: chrome.runtime.Port): void => {
		if (port.name !== 'popup-connection') return;
		state.isPopupOpen = true;
		let disconnected = false;
		const onDisconnect = (): void => {
			if (disconnected) return;
			disconnected = true;
			disconnectors.delete(onDisconnect);
			state.isPopupOpen = disconnectors.size > 0;
		};
		disconnectors.add(onDisconnect);
		port.onDisconnect.addListener(onDisconnect);
	};
	chrome.runtime.onConnect.addListener(listener);
	return () => {
		chrome.runtime.onConnect.removeListener(listener);
		for (const disconnect of [...disconnectors]) disconnect();
		disconnectors.clear();
		state.isPopupOpen = false;
	};
}
