// goal: Smooth Scroll core logic and storage

import type { ScrollSettings } from './types';
import { normalizeScrollSettings, STORAGE_KEY } from './types';

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<ScrollSettings> {
	const result = await chrome.storage.sync.get([STORAGE_KEY]);
	return normalizeScrollSettings(result[STORAGE_KEY]);
}

/**
 * Save settings to storage
 */
export async function saveSettings(
	partial: Partial<ScrollSettings>
): Promise<ScrollSettings> {
	const current = await loadSettings();
	const updated = normalizeScrollSettings({ ...current, ...partial });
	await chrome.storage.sync.set({ [STORAGE_KEY]: updated });
	return updated;
}
