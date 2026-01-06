// goal: CORS proxy utilities for Hover Zoom rules
// eff: Wraps chrome.runtime.sendMessage for Background AJAX proxy

import type { ProxyFetchOptions, ProxyAjaxResponse } from '../../rules/types';

/**
 * Fetch URL through Background proxy to bypass CORB
 * @param url - Target URL
 * @param opts - Fetch options
 * @returns Parsed response (JSON by default, or text if specified)
 */
export async function fetchWithProxy<T = unknown>(
	url: string,
	opts: ProxyFetchOptions = {}
): Promise<T> {
	const { method = 'GET', headers, body, responseType = 'json' } = opts;

	try {
		const response = await chrome.runtime.sendMessage({
			type: 'HALO_HZ_PROXY_AJAX',
			url,
			method,
			headers,
			body
		}) as ProxyAjaxResponse;

		if (!response?.success) {
			throw new Error(response?.error || 'Proxy request failed');
		}

		if (responseType === 'text') {
			return response.data as T;
		}

		return JSON.parse(response.data!) as T;
	} catch (e) {
		throw new Error(`Proxy fetch failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Get cookie value by name from document.cookie
 */
export function getCookie(name: string): string {
	const prefix = name + '=';
	const cookies = document.cookie.split(';');
	for (const cookie of cookies) {
		const c = cookie.trim();
		if (c.startsWith(prefix)) {
			return c.substring(prefix.length);
		}
	}
	return '';
}
