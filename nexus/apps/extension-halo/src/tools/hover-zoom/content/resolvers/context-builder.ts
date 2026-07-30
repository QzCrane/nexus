// Context builder for RuleEngine resolve calls

import type { ResolveContext } from '../../rules/types';
import { fetchWithProxy, getCookie } from '../utils/proxy-utils';

function resolveHostname(url: string, fallback: string): string {
	try {
		return new URL(url, window.location.href).hostname;
	} catch {
		return fallback;
	}
}

/**
 * Build a ResolveContext for the given URL and element
 * @param targetWidth - Optional display width for adaptive quality
 * @param targetHeight - Optional display height for adaptive quality
 */
export function buildContext(
	url: string,
	element: Element,
	urlHost?: string,
	targetWidth?: number,
	targetHeight?: number
): ResolveContext {
	// Extract hostname from URL if not provided
	const host = urlHost || resolveHostname(url, window.location.hostname);

	return {
		url,
		element,
		host,
		match: null,
		fetchHtml: (u) => fetchWithProxy<string>(u, { responseType: 'text' }),
		fetchJson: <T>(u: string, headers?: Record<string, string>) => fetchWithProxy<T>(u, { headers }),
		getCookie,
		targetWidth,
		targetHeight
	};
}
