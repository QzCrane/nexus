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
		column: lines[lines.length - 1].length + 1,
	};
}

/**
 * Execute regex and return matches
 */
export function executeRegex(pattern: string, testString: string, flags: RegexFlags): RegexMatch[] {
	if (!pattern || !testString) return [];

	try {
		const flagStr = buildFlagsString(flags);
		const regex = new RegExp(pattern, flagStr);
		const matches: RegexMatch[] = [];

		if (flags.global) {
			let match: RegExpExecArray | null;
			while ((match = regex.exec(testString)) !== null) {
				const pos = getLineAndColumn(testString, match.index);
				matches.push({
					index: match.index,
					text: match[0],
					groups: match.groups || null,
					line: pos.line,
					column: pos.column,
				});
				// Prevent infinite loop for zero-length matches
				if (match[0].length === 0) regex.lastIndex++;
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
	} catch {
		return [];
	}
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
