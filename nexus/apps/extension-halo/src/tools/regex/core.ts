// goal: Regex tester core logic

import type { RegexMatch, RegexFlags } from './types';

/**
 * Build flags string from flags object
 */
export function buildFlagsString(flags: RegexFlags): string {
	let str = '';
	if (flags.global) str += 'g';
	if (flags.ignoreCase) str += 'i';
	if (flags.multiline) str += 'm';
	if (flags.dotAll) str += 's';
	if (flags.unicode) str += 'u';
	return str;
}

/**
 * Get line and column from index
 */
function getLineAndColumn(text: string, index: number): { line: number; column: number } {
	const lines = text.substring(0, index).split('\n');
	return {
		line: lines.length,
		column: (lines.at(-1)?.length ?? 0) + 1,
	};
}

/** Upper bound on collected matches; protects the UI from pathological input. */
const MAX_MATCHES = 10_000;

/**
 * Execute regex and return matches
 */
export function executeRegex(pattern: string, testString: string, flags: RegexFlags): RegexMatch[] {
	if (!pattern || !testString) return [];

	const flagStr = buildFlagsString(flags);
	// Let invalid patterns surface as errors instead of an empty result.
	const regex = new RegExp(pattern, flagStr);
	const matches: RegexMatch[] = [];

	if (flags.global) {
		let match = regex.exec(testString);
		while (match !== null) {
			const pos = getLineAndColumn(testString, match.index);
			matches.push({
				index: match.index,
				text: match[0],
				groups: match.groups || null,
				line: pos.line,
				column: pos.column,
			});
			if (matches.length >= MAX_MATCHES) break;
			// Prevent infinite loops for zero-length matches: advance past one
			// full code point (surrogates must not be split in unicode mode).
			if (match[0].length === 0) {
				const codePoint = testString.codePointAt(match.index) ?? 0;
				regex.lastIndex = match.index + (codePoint > 0xffff ? 2 : 1);
			}
			match = regex.exec(testString);
		}
	} else {
		const match = regex.exec(testString);
		if (match) {
			const pos = getLineAndColumn(testString, match.index);
			matches.push({
				index: match.index,
				text: match[0],
				groups: match.groups || null,
				line: pos.line,
				column: pos.column,
			});
		}
	}

	return matches;
}

/**
 * Validate regex pattern
 */
export function validatePattern(pattern: string): { valid: boolean; error?: string } {
	if (!pattern) return { valid: true };
	try {
		new RegExp(pattern);
		return { valid: true };
	} catch (err) {
		return { valid: false, error: (err as Error).message };
	}
}

/**
 * Replace matches in text
 */
export function replaceMatches(
	pattern: string,
	testString: string,
	replacement: string,
	flags: RegexFlags
): string {
	if (!pattern || !testString) return testString;
	try {
		const flagStr = buildFlagsString(flags);
		const regex = new RegExp(pattern, flagStr);
		return testString.replace(regex, replacement);
	} catch {
		return testString;
	}
}
