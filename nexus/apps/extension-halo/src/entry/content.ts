// HALO Content Script Host
// Coordinates module loading and injection

import { enableDarkMode, disableDarkMode, isDarkModeEnabled } from '@nexus/zen-engine';

console.log('[HALO] Content script loaded');

// Initialize dark mode based on stored preference
async function initDarkMode(forceState?: boolean): Promise<void> {
	let isEnabled = forceState;

	if (isEnabled === undefined) {
		const storage = await chrome.storage.sync.get(['halo_dark_mode']);
		isEnabled = storage.halo_dark_mode ?? false;
	}

	if (isEnabled && !isDarkModeEnabled()) {
		enableDarkMode();
	} else if (!isEnabled && isDarkModeEnabled()) {
		disableDarkMode();
	}
}

// Early initialization for document_start performance
initDarkMode();

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'HALO_DARK_MODE_TOGGLE') {
		initDarkMode(message.payload);
		sendResponse({ success: true });
	}
	return false;
});
