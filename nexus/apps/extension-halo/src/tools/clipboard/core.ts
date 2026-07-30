// goal: Clipboard tool core logic

import { type ClipboardItem, STORAGE_KEY, SETTINGS_STORAGE_KEY, MAX_HISTORY } from './types';

/**
 * Get clipboard settings
 */
export async function getClipboardSettings(): Promise<{ enabled: boolean }> {
	const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
	return result[SETTINGS_STORAGE_KEY] || { enabled: true };
}

/**
 * Update clipboard settings
 */
export async function updateClipboardSettings(enabled: boolean): Promise<void> {
	await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { enabled } });
}

/**
 * Save text to history
 */
export async function saveToClipboardHistory(
	text: string,
	sourceUrl?: string,
	sourceTitle?: string
): Promise<ClipboardItem[]> {
	if (!text?.trim()) return await getClipboardHistory();

	const result = await chrome.storage.local.get([STORAGE_KEY]);
	const history: ClipboardItem[] = result[STORAGE_KEY] || [];

	// Deduplicate: if the top item is exactly the same, skip
	if (history[0]?.text === text) {
		return history;
	}

	const newItem: ClipboardItem = {
		id: Math.random().toString(36).substring(2, 11),
		text,
		timestamp: Date.now(),
		pinned: false,
		sourceUrl,
		sourceTitle,
	};

	// Keep pinned items, then unpinned ones up to limit
	const pinned = history.filter(h => h.pinned);
	const unpinned = history.filter(h => !h.pinned && h.text !== text);

	const updated = [newItem, ...pinned, ...unpinned].slice(0, MAX_HISTORY);

	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Get history
 */
export async function getClipboardHistory(): Promise<ClipboardItem[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	return result[STORAGE_KEY] || [];
}

/**
 * Toggle pin status
 */
export async function togglePin(id: string): Promise<ClipboardItem[]> {
	const history = await getClipboardHistory();
	const updated = history.map(item =>
		item.id === id ? { ...item, pinned: !item.pinned } : item
	);

	// Sort: pinned first
	updated.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.timestamp - a.timestamp;
	});

	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Delete an item
 */
export async function deleteItem(id: string): Promise<ClipboardItem[]> {
	const history = await getClipboardHistory();
	const updated = history.filter(item => item.id !== id);
	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Clear all unpinned items
 */
export async function clearUnpinned(): Promise<ClipboardItem[]> {
	const history = await getClipboardHistory();
	const updated = history.filter(item => item.pinned);
	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
