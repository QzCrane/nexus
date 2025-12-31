// goal: Cookie Manager core logic - read, edit, delete cookies

import type { CookieInfo } from './types';

// Get all cookies for current tab
export async function getCookiesForCurrentTab(): Promise<CookieInfo[]> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.url) return [];

		const url = new URL(tab.url);
		const cookies = await chrome.cookies.getAll({ domain: url.hostname });

		return cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain,
			path: c.path,
			expires: c.expirationDate,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite || 'unspecified',
		}));
	} catch {
		return [];
	}
}

// Delete a cookie
export async function deleteCookie(name: string, domain: string, path: string): Promise<boolean> {
	try {
		const url = `http${domain.startsWith('.') ? 's' : ''}://${domain.replace(/^\./, '')}${path}`;
		await chrome.cookies.remove({ url, name });
		return true;
	} catch {
		return false;
	}
}

// Set/update a cookie
export async function setCookie(cookie: CookieInfo): Promise<boolean> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.url) return false;

		await chrome.cookies.set({
			url: tab.url,
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain || undefined,
			path: cookie.path || '/',
			secure: cookie.secure,
			httpOnly: cookie.httpOnly,
			sameSite: cookie.sameSite as chrome.cookies.SameSiteStatus,
			expirationDate: cookie.expires,
		});
		return true;
	} catch {
		return false;
	}
}

// Export cookies as JSON
export function exportCookies(cookies: CookieInfo[]): string {
	return JSON.stringify(cookies, null, 2);
}

// Format expiration date
export function formatExpiry(timestamp: number | undefined): string {
	if (!timestamp) return 'Session';
	const date = new Date(timestamp * 1000);
	return date.toLocaleDateString();
}
