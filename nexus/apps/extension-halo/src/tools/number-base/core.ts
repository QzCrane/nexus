// goal: Number Base core logic - convert between number bases

import type { Base, BaseConvertResult } from './types';

// Convert from any base to all bases
export function convertBase(input: string, fromBase: Base): BaseConvertResult | null {
	if (!isValidForBase(input, fromBase)) return null;
	const text = input.trim();
	const negative = text.startsWith('-');
	const unsigned = text.replace(/^[+-]/u, '');
	const prefix = { 2: '0b', 8: '0o', 10: '', 16: '0x' }[fromBase];
	const digits = unsigned.replace(fromBase === 2 ? /^0b/iu : fromBase === 8 ? /^0o/iu : fromBase === 16 ? /^0x/iu : /$^/u, '');
	const value = BigInt(prefix + digits) * (negative ? -1n : 1n);
	return {
		binary: value.toString(2), octal: value.toString(8),
		decimal: value.toString(10), hex: value.toString(16).toUpperCase(),
	};
}

// A finite interactive input contract avoids unbounded BigInt parsing work.
export function isValidForBase(input: string, base: Base): boolean {
	if (input.length > 65_536) return false;
	const patterns: Record<Base, RegExp> = {
		2: /^[+-]?(?:0b)?[01]+$/iu,
		8: /^[+-]?(?:0o)?[0-7]+$/iu,
		10: /^[+-]?\d+$/u,
		16: /^[+-]?(?:0x)?[0-9a-f]+$/iu,
	};
	return patterns[base]?.test(input.trim()) ?? false;
}

export function formatWithGrouping(value: string, groupSize: number): string {
	if (!Number.isSafeInteger(groupSize) || groupSize < 1) throw new RangeError('Invalid grouping size');
	const sign = /^[+-]/u.test(value) ? value.charAt(0) : '';
	const digits = value.slice(sign.length);
	const groups: string[] = [];
	for (let end = digits.length; end > 0; end -= groupSize) {
		groups.push(digits.slice(Math.max(0, end - groupSize), end));
	}
	return sign + groups.reverse().join(' ');
}

// Base labels
export const BASE_LABELS: Record<Base, string> = {
	2: 'Binary (2)',
	8: 'Octal (8)',
	10: 'Decimal (10)',
	16: 'Hex (16)',
};
