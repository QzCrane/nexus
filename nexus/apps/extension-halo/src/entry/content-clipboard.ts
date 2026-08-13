// goal: minimal all-frame clipboard capture host
// inv: This all-frame surface owns clipboard capture only; other all-frame capabilities keep separate physical entries.
// inv: No generic tool router, DOM tooling, smooth scroll, or UI dependencies here.

import { parseClipboardSettings, SETTINGS_STORAGE_KEY } from '../tools/clipboard/types';

const LOG_TAG = '[HALO:Clipboard]';

function isExpectedRuntimeDisconnect(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Extension context invalidated') ||
		message.includes('Receiving end does not exist') ||
		message.includes('message port closed');
}

let listenerAttached = false;
let settingsEventObserved = false;

function captureSelection(): void {
	// Copy dispatch precedes some pages' selection bookkeeping. Preserve the
	// bounded post-copy delay used by the previous host without keeping a timer
	// alive between copy events. If the feature is disabled during that bounded
	// delay, the pending capture loses ownership and exits without writing.
	setTimeout(() => {
		if (!listenerAttached) return;
		const active = document.activeElement;
		if (active instanceof HTMLInputElement && active.type === 'password') return;

		const selection = document.getSelection()?.toString();
		if (!selection?.trim()) return;

		try {
			void chrome.runtime.sendMessage({
				type: 'HALO_CLIPBOARD_ADD',
				text: selection,
				sourceUrl: window.location.href,
				sourceTitle: document.title,
			}).catch((error: unknown) => {
				if (!isExpectedRuntimeDisconnect(error)) {
					console.warn(LOG_TAG, 'History notification failed', error);
				}
			});
		} catch (error: unknown) {
			if (!isExpectedRuntimeDisconnect(error)) {
				console.warn(LOG_TAG, 'History notification failed', error);
			}
		}
	}, 50);
}

function updateClipboardState(enabled: boolean): void {
	if (enabled === listenerAttached) return;
	listenerAttached = enabled;
	if (enabled) document.addEventListener('copy', captureSelection);
	else document.removeEventListener('copy', captureSelection);
}

// Subscribe before the asynchronous initial read. A storage change that wins
// the race becomes authoritative; the delayed initial snapshot may not clobber
// that newer event-owned state.
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	const change = changes[SETTINGS_STORAGE_KEY];
	if (!change) return;
	settingsEventObserved = true;
	updateClipboardState(parseClipboardSettings(change.newValue).enabled);
});

// Clipboard is not a ready product surface. Missing, malformed, or unreadable
// settings therefore fail closed; only an explicit persisted enablement may
// attach the all-frame copy listener.
try {
	void chrome.storage.local.get([SETTINGS_STORAGE_KEY]).then((result) => {
		if (settingsEventObserved) return;
		updateClipboardState(parseClipboardSettings(result[SETTINGS_STORAGE_KEY]).enabled);
	}).catch((error: unknown) => {
		if (settingsEventObserved || isExpectedRuntimeDisconnect(error)) return;
		console.warn(LOG_TAG, 'Initial settings read failed', error);
		updateClipboardState(false);
	});
} catch (error: unknown) {
	if (!isExpectedRuntimeDisconnect(error)) {
		console.warn(LOG_TAG, 'Storage context unavailable', error);
		if (!settingsEventObserved) updateClipboardState(false);
	}
}
