import type { UserScript } from './types';

// Get scripts matching a URL
export function getMatchingScripts(scripts: UserScript[], url: string): UserScript[] {
	return scripts
		.filter((s) => s.enabled && matchesUrl(s.matches, url) && !matchesUrl(s.excludeMatches || [], url))
		.sort((a, b) => a.order - b.order);
}

// URL pattern matching (simplified glob-style)
export function matchesUrl(patterns: string[], url: string): boolean {
	for (const pattern of patterns) {
		const regex = patternToRegex(pattern);
		if (regex.exec(url) !== null) return true;
	}
	return false;
}

// Convert URL pattern to regex
function patternToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
		.replace(/\*/g, '.*');                   // * becomes .*
	return new RegExp(`^${escaped}$`, 'i');
}
