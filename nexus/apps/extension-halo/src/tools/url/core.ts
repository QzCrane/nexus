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
		const params: Record<string, string> = {};
		url.searchParams.forEach((value, key) => {
			params[key] = value;
		});

		return {
			Protocol: url.protocol,
			Host: url.host,
			Path: url.pathname,
			Query: url.search,
			Hash: url.hash,
			Params: JSON.stringify(params, null, 2),
		};
	} catch (e) {
		throw new Error('Invalid URL');
	}
}
