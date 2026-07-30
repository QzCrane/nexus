// goal: Text Tools core logic - case conversion, stats, dedupe, sort

import type { CaseType, TextStats } from './types';

// Case conversion functions
export function convertCase(text: string, caseType: CaseType): string {
	switch (caseType) {
		case 'lower':
			return text.toLowerCase();
		case 'upper':
			return text.toUpperCase();
		case 'title':
			return text.replace(/\b\w/g, (c) => c.toUpperCase());
		case 'sentence':
			return text.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
		case 'camel':
			return toCamelCase(text);
		case 'snake':
			return toSnakeCase(text);
		case 'constant':
			return toSnakeCase(text).toUpperCase();
		case 'kebab':
			return toSnakeCase(text).replace(/_/g, '-');
		default:
			return text;
	}
}

// Helper: convert to camelCase
function toCamelCase(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
		.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

// Helper: convert to snake_case
function toSnakeCase(text: string): string {
	return text
		.replace(/([A-Z])/g, '_$1')
		.replace(/[\s-]+/g, '_')
		.replace(/^_/, '')
		.replace(/_+/g, '_')
		.toLowerCase();
}

// Text statistics
export function getTextStats(text: string): TextStats {
	const chars = text.length;
	const charsNoSpaces = text.replace(/\s/g, '').length;
	const words = text.trim() ? text.trim().split(/\s+/).length : 0;
	const lines = text ? text.split(/\r?\n/).length : 0;
	const bytes = new Blob([text]).size;
	return { chars, charsNoSpaces, words, lines, bytes };
}

// Remove duplicate lines
export function dedupeLines(text: string): string {
	const lines = text.split(/\r?\n/);
	const seen = new Set<string>();
	const unique = lines.filter((line) => {
		if (seen.has(line)) return false;
		seen.add(line);
		return true;
	});
	return unique.join('\n');
}

// Sort lines
export function sortLines(text: string, ascending = true): string {
	const lines = text.split(/\r?\n/);
	lines.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	if (!ascending) lines.reverse();
	return lines.join('\n');
}

// Trim each line
export function trimLines(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.join('\n');
}

// Reverse lines
export function reverseLines(text: string): string {
	return text.split(/\r?\n/).reverse().join('\n');
}
