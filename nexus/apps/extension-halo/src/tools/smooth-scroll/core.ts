// goal: Smooth Scroll core logic and storage

import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, STORAGE_KEY } from './types';

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<ScrollSettings> {
	const result = await chrome.storage.sync.get([STORAGE_KEY]);
	return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
}

/**
 * Save settings to storage
 */
export async function saveSettings(
	partial: Partial<ScrollSettings>
): Promise<ScrollSettings> {
	const current = await loadSettings();
	const updated = { ...current, ...partial };
	await chrome.storage.sync.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Get easing function as CSS timing function
 */
export function getEasingCSS(easing: ScrollSettings['easing']): string {
	switch (easing) {
		case 'linear':
			return 'linear';
		case 'ease':
			return 'ease';
		case 'ease-out':
			return 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
		case 'spring':
			return 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
		default:
			return 'ease-out';
	}
}

/**
 * Calculate scroll duration based on smoothness
 */
export function getScrollDuration(smoothness: number): number {
	// smoothness 1-10 maps to 100ms-800ms
	return 100 + (smoothness - 1) * 77.78;
}

/**
 * Broadcast settings to all tabs
 */
export async function broadcastSettings(settings: ScrollSettings): Promise<void> {
	const tabs = await chrome.tabs.query({});
	for (const tab of tabs) {
		if (tab.id) {
			try {
				await chrome.tabs.sendMessage(tab.id, {
					type: 'HALO_SMOOTH_SCROLL_UPDATE',
					settings,
				});
			} catch {
				// Tab may not have content script
			}
		}
	}
}
