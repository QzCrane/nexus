// Common parsing utilities for rule resolvers

/**
 * Parse embedded script data from HTML
 * @param html - HTML content
 * @param token - Token to search for (e.g. 'window.__playinfo__={')
 */
export function parseEmbeddedJson<T>(html: string, token: string): T | null {
	const idx = html.indexOf(token);
	if (idx === -1) return null;

	const start = idx + token.length - 1;
	let depth = 0;
	let end = start;

	for (let i = start; i < html.length; i++) {
		if (html[i] === '{' || html[i] === '[') depth++;
		else if (html[i] === '}' || html[i] === ']') {
			depth--;
			if (depth === 0) { end = i + 1; break; }
		}
	}

	try {
		return JSON.parse(html.substring(start, end)) as T;
	} catch { return null; }
}

/** Sort array by bandwidth descending (for video quality selection) */
export const sortByBandwidth = <T extends { bandwidth: number }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => b.bandwidth - a.bandwidth);
