// HALO Background Service Worker
// Handles extension lifecycle and storage initialization

import { STORAGE_KEYS } from '../kernel/storage';

console.log('[HALO] Background service worker initialized');

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
	console.log('[HALO] Extension installed/updated', details.reason);

	// Set defaults if not already set
	const storage = await chrome.storage.sync.get([
		STORAGE_KEYS.DARK_MODE_ENABLED,
		STORAGE_KEYS.DARK_MODE_WHITELIST
	]);

	const defaults: Record<string, unknown> = {};

	if (storage[STORAGE_KEYS.DARK_MODE_ENABLED] === undefined) {
		defaults[STORAGE_KEYS.DARK_MODE_ENABLED] = false;
	}

	if (!storage[STORAGE_KEYS.DARK_MODE_WHITELIST]) {
		// Default whitelist: sites that typically have good dark modes already
		defaults[STORAGE_KEYS.DARK_MODE_WHITELIST] = [
			'github.com',
			'twitter.com',
			'x.com',
			'discord.com'
		];
	}

	if (Object.keys(defaults).length > 0) {
		await chrome.storage.sync.set(defaults);
		console.log('[HALO] Default settings initialized:', defaults);
	}
});

// Log storage changes for debugging
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'sync') {
		for (const [key, { newValue }] of Object.entries(changes)) {
			console.log(`[HALO] Storage changed: ${key}`, newValue);
		}
	}
});
