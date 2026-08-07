// goal: minimal all-frame clipboard capture host
// inv: This is the only HALO static content surface allowed in every frame.
// inv: No generic tool router, DOM tooling, smooth scroll, or UI dependencies here.

export {};

const SETTINGS_KEY = 'halo_tool_clipboard_settings';
const LOG_TAG = '[HALO:Clipboard]';

function isExpectedRuntimeDisconnect(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Extension context invalidated') ||
		message.includes('Receiving end does not exist') ||
		message.includes('message port closed');
}

function captureSelection(): void {
	// Copy dispatch precedes some pages' selection bookkeeping. Preserve the
	// bounded post-copy delay used by the previous host without keeping a timer
	// alive between copy events.
	setTimeout(() => {
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

let listenerAttached = false;

function updateClipboardState(enabled: boolean): void {
	if (enabled === listenerAttached) return;
	listenerAttached = enabled;
	if (enabled) document.addEventListener('copy', captureSelection);
	else document.removeEventListener('copy', captureSelection);
}

function readEnabled(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return true;
	const enabled = (value as { enabled?: unknown }).enabled;
	return typeof enabled === 'boolean' ? enabled : true;
}

// Clipboard history retains the existing default-on contract for this pass;
// structural isolation makes that contract cheap without silently changing
// existing users' behavior. A future product decision can change the default
// in one shared settings owner instead of coupling it to content-host loading.
try {
	void chrome.storage.local.get([SETTINGS_KEY]).then((result) => {
		updateClipboardState(readEnabled(result[SETTINGS_KEY]));
	}).catch((error: unknown) => {
		if (!isExpectedRuntimeDisconnect(error)) {
			console.warn(LOG_TAG, 'Initial settings read failed', error);
		}
	});
} catch (error: unknown) {
	if (!isExpectedRuntimeDisconnect(error)) {
		console.warn(LOG_TAG, 'Storage context unavailable', error);
	}
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') return;
	const change = changes[SETTINGS_KEY];
	if (!change) return;
	updateClipboardState(readEnabled(change.newValue));
});
