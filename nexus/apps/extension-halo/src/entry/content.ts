// HALO Content Script Host
// goal: fast dark mode activation with prewarming and caching

import { enableDarkMode, disableDarkMode, isDarkModeEnabled, prewarmDarkReader } from '../modules/dark-mode';
import { getCurrentHostname, isHostnameWhitelisted, getDarkModeSettings } from '../kernel/storage';

const t0 = performance.now();
console.log('[HALO] Content script loaded at', t0.toFixed(2), 'ms');

// eff: prewarm darkreader immediately (before even checking if enabled)
prewarmDarkReader();

// Initialize dark mode based on stored preference, whitelist, and config
async function initDarkMode(forceState?: boolean): Promise<void> {
	const hostname = getCurrentHostname();

	// Check whitelist first (skip if whitelisted)
	if (hostname && await isHostnameWhitelisted(hostname)) {
		if (isDarkModeEnabled()) disableDarkMode();
		console.log('[HALO] Site whitelisted:', hostname);
		return;
	}

	const settings = await getDarkModeSettings();
	const isEnabled = forceState ?? settings.enabled;

	if (isEnabled && !isDarkModeEnabled()) {
		const t1 = performance.now();
		enableDarkMode(settings.config, settings.fixes);
		console.log('[HALO] Dark mode enabled in', (performance.now() - t1).toFixed(2), 'ms');
	} else if (!isEnabled && isDarkModeEnabled()) {
		disableDarkMode();
	}
}

// Early initialization for document_start performance
initDarkMode();

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'HALO_DARK_MODE_TOGGLE':
			initDarkMode(message.payload);
			sendResponse({ success: true });
			break;

		case 'HALO_WHITELIST_CHANGED':
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
