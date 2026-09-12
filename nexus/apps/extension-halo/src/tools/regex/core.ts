// goal: Regex tester core logic

import type { RegexMatch, RegexFlags } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const regexFlagsCodec: ToolStateCodec<RegexFlags> = {
	decode(value) {
		const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
			&& (value as Record<string, unknown>).version === 1
			? (value as Record<string, unknown>).value
			: value;
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid', reason: 'Regex flags are not a record.' };
		const flags = raw as Record<string, unknown>;
		if (typeof flags.global !== 'boolean' || typeof flags.ignoreCase !== 'boolean' || typeof flags.multiline !== 'boolean'
			|| typeof flags.dotAll !== 'boolean' || typeof flags.unicode !== 'boolean') return { kind: 'invalid', reason: 'Regex flags must be booleans.' };
		return { kind: 'valid', value: flags as unknown as RegexFlags };
	},
	encode(value) { return { version: 1, value }; },
};

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
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) starts.push(index + 1);
	}
	return starts;
}

function getLineAndColumn(starts: readonly number[], index: number): { line: number; column: number } {
	let low = 0;
	let high = starts.length;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if ((starts[middle] ?? 0) <= index) low = middle;
		else high = middle;
	}
	return { line: low + 1, column: index - (starts[low] ?? 0) + 1 };
}

/** Upper bound on collected matches; protects the UI from pathological input. */
export const MAX_MATCHES = 10_000;
export const REGEX_MAX_PATTERN_UNITS = 4_096;
export const REGEX_MAX_TEXT_UNITS = 1_048_576;
export const REGEX_MAX_REPLACEMENT_UNITS = 65_536;
export const REGEX_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function assertRegexInputs(pattern: string, testString: string, replacement = ''): void {
	if (pattern.length > REGEX_MAX_PATTERN_UNITS) throw new Error('Pattern exceeds the 4096-character limit.');
	if (testString.length > REGEX_MAX_TEXT_UNITS) throw new Error('Test text exceeds the 1048576-character limit.');
	if (replacement.length > REGEX_MAX_REPLACEMENT_UNITS) throw new Error('Replacement exceeds the 65536-character limit.');
}

/**
 * Execute regex and return matches
 */
export function executeRegex(pattern: string, testString: string, flags: RegexFlags): RegexMatch[] {
	if (!pattern || !testString) return [];
	assertRegexInputs(pattern, testString);

	const flagStr = buildFlagsString(flags);
	// Let invalid patterns surface as errors instead of an empty result.
	const regex = new RegExp(pattern, flagStr);
	const matches: RegexMatch[] = [];
	const starts = lineStarts(testString);

	if (flags.global) {
		let match = regex.exec(testString);
		while (match !== null) {
			const pos = getLineAndColumn(starts, match.index);
			matches.push({
				index: match.index,
				text: match[0],
				groups: match.groups || null,
				line: pos.line,
				column: pos.column,
			});
			if (matches.length >= MAX_MATCHES) {
				throw new Error(`Match count reaches the ${MAX_MATCHES} limit.`);
			}
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
			const pos = getLineAndColumn(starts, match.index);
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
 * Replace matches in text
 */
export function replaceMatches(
	pattern: string,
	testString: string,
	replacement: string,
	flags: RegexFlags,
	knownMatches?: readonly RegexMatch[]
): string {
	if (!pattern || !testString) return testString;
	assertRegexInputs(pattern, testString, replacement);
	const matches = knownMatches ?? executeRegex(pattern, testString, flags);
	// Bound replacement before String.replace allocates it. Capture and context
	// substitutions can expand to the whole input; all other substitutions are
	// bounded by the matched text. Three UTF-8 bytes per UTF-16 unit is a safe
	// upper bound, including surrogate pairs (four bytes for two units).
	const mayReferenceInput = /\$(?:`|'|[1-9][0-9]?|<)/u.test(replacement);
	const removedUnits = matches.reduce((sum, match) => sum + match.text.length, 0);
	const replacementUpperUnits = matches.reduce(
		(sum, match) => sum + replacement.length * (mayReferenceInput ? testString.length + 1 : match.text.length + 1),
		0
	);
	if ((testString.length - removedUnits + replacementUpperUnits) * 3 > REGEX_MAX_OUTPUT_BYTES) {
		throw new Error('Replacement output may exceed the 4 MiB limit.');
	}
	const flagStr = buildFlagsString(flags);
	const regex = new RegExp(pattern, flagStr);
	const output = testString.replace(regex, replacement);
	if (new TextEncoder().encode(output).byteLength > REGEX_MAX_OUTPUT_BYTES) {
		throw new Error('Replacement output exceeds the 4 MiB limit.');
	}
	return output;
}
