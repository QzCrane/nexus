// goal: Cookie Manager core logic - read, edit, delete cookies
// rule: every operation carries the full cookie identity (store, partition,
// host-only flag, scheme, domain, path). The update target is derived from the
// cookie itself, never from whichever tab happens to be active.

import type { CookieInfo } from './types';

export interface CookieScan {
	origin: string;
	cookies: CookieInfo[];
}

function originOf(url: string | undefined): string {
	try { return new URL(url ?? '').origin; } catch { return ''; }
}

function hostOf(domain: string): string {
	return domain.replace(/^\./, '');
}

// Get all cookies for the current tab, bound to its origin at scan time
export async function scanActiveTabCookies(): Promise<CookieScan> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.url) throw new Error('No active tab with a scannable URL.');

	const url = new URL(tab.url);
	const cookies = await chrome.cookies.getAll({ domain: url.hostname });

	return {
		origin: originOf(tab.url),
		cookies: cookies.map((c) => ({
			name: c.name,
			value: c.value,
			domain: c.domain,
			path: c.path,
			expires: c.expirationDate,
			httpOnly: c.httpOnly,
			secure: c.secure,
			sameSite: c.sameSite || 'unspecified',
			hostOnly: c.hostOnly,
			session: c.session,
			storeId: c.storeId,
			partitionKey: c.partitionKey,
		})),
	};
}

/**
 * The URL that addresses this exact cookie: scheme from its secure flag, host
 * from its domain, and its own path.
 */
export function cookieUrl(cookie: Pick<CookieInfo, 'secure' | 'domain' | 'path'>): string {
	return `${cookie.secure ? 'https' : 'http'}://${hostOf(cookie.domain)}${cookie.path || '/'}`;
}

// Delete a cookie by its full identity
export async function deleteCookie(cookie: CookieInfo): Promise<boolean> {
	try {
		const details: Parameters<typeof chrome.cookies.remove>[0] = {
			url: cookieUrl(cookie),
			name: cookie.name,
		};
		if (cookie.storeId !== undefined) details.storeId = cookie.storeId;
		if (cookie.partitionKey !== undefined) details.partitionKey = cookie.partitionKey;
		await chrome.cookies.remove(details);
		return true;
	} catch {
		return false;
	}
}

// Set/update a cookie using its own identity as the target
export async function setCookie(cookie: CookieInfo): Promise<boolean> {
	try {
		const details: Parameters<typeof chrome.cookies.set>[0] = {
			url: cookieUrl(cookie),
			name: cookie.name,
			value: cookie.value,
			path: cookie.path || '/',
			secure: cookie.secure,
			httpOnly: cookie.httpOnly,
			sameSite: cookie.sameSite as chrome.cookies.SameSiteStatus,
			expirationDate: cookie.expires,
		};
		// A host-only cookie must never gain a domain attribute: that would
		// silently turn it into a domain cookie shared with subdomains.
		if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain;
		if (cookie.storeId !== undefined) details.storeId = cookie.storeId;
		if (cookie.partitionKey !== undefined) details.partitionKey = cookie.partitionKey;
		await chrome.cookies.set(details);
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
