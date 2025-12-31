// goal: Headers Viewer core logic - fetch and analyze headers

import type { HeaderInfo, HeaderCategory } from './types';

// Security headers
const SECURITY_HEADERS = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'x-xss-protection', 'referrer-policy', 'permissions-policy'];

// Caching headers
const CACHING_HEADERS = ['cache-control', 'expires', 'etag', 'last-modified', 'age', 'vary'];

// Categorize header
function categorizeHeader(name: string): HeaderCategory {
	const lower = name.toLowerCase();
	if (SECURITY_HEADERS.includes(lower)) return 'security';
	if (CACHING_HEADERS.includes(lower)) return 'caching';
	return 'other';
}

// Fetch headers for URL
export async function fetchHeaders(url: string): Promise<HeaderInfo[]> {
	try {
		const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
		const headers: HeaderInfo[] = [];

		response.headers.forEach((value, name) => {
			headers.push({ name, value, category: categorizeHeader(name) });
		});

		return headers.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		// Try GET if HEAD fails
		try {
			const response = await fetch(url, { mode: 'cors' });
			const headers: HeaderInfo[] = [];
			response.headers.forEach((value, name) => {
				headers.push({ name, value, category: categorizeHeader(name) });
			});
			return headers.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			return [];
		}
	}
}

// Get current tab URL
export async function getCurrentTabUrl(): Promise<string | null> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		return tab?.url || null;
	} catch {
		return null;
	}
}

// Category colors
export const CATEGORY_COLORS: Record<HeaderCategory, string> = {
	request: '#3b82f6',
	response: '#22c55e',
	security: '#ef4444',
	caching: '#f59e0b',
	other: '#6b7280',
};
