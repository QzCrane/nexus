// Common parsing utilities for rule resolvers

/**
 * Parse embedded script data from HTML
 * @param html - HTML content
 * @param token - Token to search for (e.g. 'window.__playinfo__={')
 */
export function parseEmbeddedJson<T>(html: string, token: string): T | null {
	const idx = html.indexOf(token);
	if (idx === -1) return null;

	// Assume token ends with the opening brace/bracket, e.g. "var x={"
	const start = idx + token.length - 1;
	return extractJsonFromIndex<T>(html, start);
}

/**
 * Extract JSON object/array from a specific index in string
 * Handles nested braces and string escaping
 */
export function extractJsonFromIndex<T>(html: string, startIndex: number): T | null {
	let depth = 0;
	let inString = false;
	let escape = false;
	let end = startIndex;
	const len = html.length;

	// Determine if we are looking for object or array
	const startChar = html[startIndex];
	if (startChar !== '{' && startChar !== '[') return null;

	for (let i = startIndex; i < len; i++) {
		const char = html[i];

		if (escape) {
			escape = false;
			continue;
		}

		if (char === '\\') {
			escape = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === '{' || char === '[') {
				depth++;
			} else if (char === '}' || char === ']') {
				depth--;
				if (depth === 0) {
					end = i + 1;
					break;
				}
			}
		}
	}

	try {
		return JSON.parse(html.substring(startIndex, end)) as T;
	} catch {
		return null;
	}
}

/**
 * Find and parse a JSON object assigned to a variable
 * Matches: varName \s* = \s* { ... }
 */
export function extractJsonFromVar<T>(html: string, varName: string): T | null {
	const regex = new RegExp(`${varName}\\s*=\\s*([{\\[])`);
	const match = regex.exec(html);
	if (!match) return null;

	const brace = match[1];
	if (!brace) return null;

	// match.index is start of varName
	// match[1] is the opening brace '{' or '['
	// We need the index of the opening brace in the original string
	const openBraceIndex = match.index + match[0].lastIndexOf(brace);

	return extractJsonFromIndex<T>(html, openBraceIndex);
}

/** Sort array by bandwidth descending (for video quality selection) */
export const sortByBandwidth = <T extends { bandwidth: number }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => b.bandwidth - a.bandwidth);
