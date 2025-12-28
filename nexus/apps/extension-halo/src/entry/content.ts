// HALO Content Script Host
// Optimized for <50ms dark mode activation (ref: market-research-dark-reader.md)

import { enableDarkMode, disableDarkMode, isDarkModeEnabled, DARK_MODE_PRESETS } from '@nexus/zen-engine';
import { STORAGE_KEYS, getCurrentHostname, isHostnameWhitelisted } from '../kernel/storage';

console.log('[HALO] Content script loaded at', performance.now().toFixed(2), 'ms');

// Initialize dark mode based on stored preference and whitelist
async function initDarkMode(forceState?: boolean): Promise<void> {
	const hostname = getCurrentHostname();

	// Check whitelist first (skip if whitelisted)
	if (hostname && await isHostnameWhitelisted(hostname)) {
		if (isDarkModeEnabled()) {
			disableDarkMode();
		}
		console.log('[HALO] Site whitelisted:', hostname);
		return;
	}

	let isEnabled = forceState;

	if (isEnabled === undefined) {
		const storage = await chrome.storage.sync.get([STORAGE_KEYS.DARK_MODE_ENABLED]);
		isEnabled = storage[STORAGE_KEYS.DARK_MODE_ENABLED] ?? false;
	}

	if (isEnabled && !isDarkModeEnabled()) {
		// Enable with performance logging in dev builds
		enableDarkMode({
			...DARK_MODE_PRESETS.default,
			enablePerfLog: true
		});
	} else if (!isEnabled && isDarkModeEnabled()) {
		disableDarkMode();
	}
}

// Early initialization for document_start performance
// This runs before DOM is ready, ensuring no white flash
initDarkMode();

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'HALO_DARK_MODE_TOGGLE':
			initDarkMode(message.payload);
			sendResponse({ success: true });
			break;

		case 'HALO_WHITELIST_CHANGED':
			// Re-check whitelist after change
			initDarkMode();
			sendResponse({ success: true });
			break;

		case 'HALO_GET_STATUS':
			sendResponse({
				hostname: getCurrentHostname(),
				darkModeActive: isDarkModeEnabled()
			});
			break;

		default:
			sendResponse({ success: false, error: 'Unknown message type' });
	}
	return false;
});
