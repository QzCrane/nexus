// goal: Bookmark Manager core logic - search and manage bookmarks

import type { BookmarkNode, BookmarkSearchResult } from './types';

// Get all bookmarks
export async function getAllBookmarks(): Promise<BookmarkNode[]> {
	return new Promise((resolve) => {
		chrome.bookmarks.getTree((nodes) => resolve(nodes as BookmarkNode[]));
	});
}

// Search bookmarks
export async function searchBookmarks(query: string): Promise<BookmarkSearchResult[]> {
	if (!query.trim()) return [];

	return new Promise((resolve) => {
		chrome.bookmarks.search(query, async (results) => {
			const items: BookmarkSearchResult[] = [];

			for (const item of results.slice(0, 50)) {
				if (!item.url) continue;

				// Get parent folder name
				let parentTitle = '';
				if (item.parentId) {
					try {
						const [parent] = await chrome.bookmarks.get(item.parentId);
						parentTitle = parent?.title || '';
					} catch { /* ignore */ }
				}

				items.push({
					id: item.id,
					title: item.title,
					url: item.url,
					parentTitle,
				});
			}

			resolve(items);
		});
	});
}

// Delete bookmark
export async function deleteBookmark(id: string): Promise<void> {
	return chrome.bookmarks.remove(id);
}

// Open bookmark
export function openBookmark(url: string, newTab = false): void {
	if (newTab) {
		chrome.tabs.create({ url });
	} else {
		chrome.tabs.update({ url });
	}
}

// Get recent bookmarks
export async function getRecentBookmarks(limit = 20): Promise<BookmarkSearchResult[]> {
	return new Promise((resolve) => {
		chrome.bookmarks.getRecent(limit, async (results) => {
			const items: BookmarkSearchResult[] = [];

			for (const item of results) {
				if (!item.url) continue;

				let parentTitle = '';
				if (item.parentId) {
					try {
						const [parent] = await chrome.bookmarks.get(item.parentId);
						parentTitle = parent?.title || '';
					} catch { /* ignore */ }
				}

				items.push({
					id: item.id,
					title: item.title,
					url: item.url,
					parentTitle,
				});
			}

			resolve(items);
		});
	});
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
