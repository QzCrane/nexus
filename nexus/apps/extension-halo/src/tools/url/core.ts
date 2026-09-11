// goal: URL encode/decode/parse core logic

/**
 * Encode URL component
 */
export function encode(input: string): string {
	return encodeURIComponent(input);
}

/**
 * Decode URL component
 */
export function decode(input: string): string {
	return decodeURIComponent(input);
}

/**
 * Parse URL components
 */
export function parseURL(input: string): Record<string, string> {
	try {
		const url = new URL(input);
		// An ordered sequence preserves repeated names, order, empty keys and values.
		const params = Array.from(url.searchParams, ([name, value]) => ({ name, value }));

		return {
			Protocol: url.protocol,
			Host: url.host,
			Path: url.pathname,
			Query: url.search,
			Hash: url.hash,
			Params: JSON.stringify(params, null, 2),
		};
	} catch (_e) {
		throw new Error('Invalid URL');
	}
}
