// goal: History Search core logic - search and manage history

import type { HistoryItem } from './types';

// Search history
export async function searchHistory(query: string, maxResults = 50): Promise<HistoryItem[]> {
	return new Promise((resolve) => {
		chrome.history.search(
			{ text: query, maxResults, startTime: 0 },
			(results) => {
				const items: HistoryItem[] = results.map((r) => ({
					id: r.id || '',
					url: r.url || '',
					title: r.title || r.url || '',
					lastVisitTime: r.lastVisitTime || 0,
					visitCount: r.visitCount || 0,
				}));
				resolve(items);
			}
		);
	});
}

// Delete history item
export async function deleteHistoryItem(url: string): Promise<void> {
	return chrome.history.deleteUrl({ url });
}

// Get recent history
export async function getRecentHistory(maxResults = 30): Promise<HistoryItem[]> {
	return searchHistory('', maxResults);
}

// Format time ago
export function formatTimeAgo(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	if (diff < 60000) return 'Just now';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
	return new Date(timestamp).toLocaleDateString();
}

// Get favicon URL
export function getFaviconUrl(url: string): string {
	try {
		const hostname = new URL(url).hostname;
		return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
	} catch {
		return '';
	}
}
