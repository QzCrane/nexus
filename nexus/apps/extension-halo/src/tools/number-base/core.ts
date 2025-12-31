// goal: Number Base core logic - convert between number bases

import type { Base, BaseConvertResult } from './types';

// Convert from any base to all bases
export function convertBase(input: string, fromBase: Base): BaseConvertResult | null {
	try {
		// Parse to decimal first
		const decimal = parseInt(input, fromBase);
		if (isNaN(decimal)) return null;

		return {
			binary: decimal.toString(2),
			octal: decimal.toString(8),
			decimal: decimal.toString(10),
			hex: decimal.toString(16).toUpperCase(),
		};
	} catch {
		return null;
	}
}

// Validate input for a specific base
export function isValidForBase(input: string, base: Base): boolean {
	if (!input) return false;
	const patterns: Record<Base, RegExp> = {
		2: /^[01]+$/,
		8: /^[0-7]+$/,
		10: /^-?\d+$/,
		16: /^[0-9A-Fa-f]+$/,
	};
	return patterns[base].test(input);
}

// Format with grouping (for readability)
export function formatWithGrouping(value: string, groupSize: number): string {
	const reversed = value.split('').reverse();
	const groups: string[] = [];
	for (let i = 0; i < reversed.length; i += groupSize) {
		groups.push(reversed.slice(i, i + groupSize).reverse().join(''));
	}
	return groups.reverse().join(' ');
}

// Base labels
export const BASE_LABELS: Record<Base, string> = {
	2: 'Binary (2)',
	8: 'Octal (8)',
	10: 'Decimal (10)',
	16: 'Hex (16)',
};
