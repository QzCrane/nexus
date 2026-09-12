// goal: Ruler measurement logic

import type { RulerMeasurement } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const rulerUnitCodec: ToolStateCodec<'px' | 'rem'> = {
	decode(value) { return value === 'px' || value === 'rem' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Ruler unit must be px or rem.' }; },
	encode(value) { return value; },
};

export const rulerRemBaseCodec: ToolStateCodec<number> = {
	decode(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100 ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Ruler rem base must be between 1 and 100 pixels.' }; },
	encode(value) { return value; },
};

/**
 * Calculate measurement from two points
 */
export function calculateMeasurement(
	startX: number,
	startY: number,
	endX: number,
	endY: number
): RulerMeasurement {
	const width = Math.abs(endX - startX);
	const height = Math.abs(endY - startY);
	const diagonal = Math.sqrt(width * width + height * height);

	return {
		startX: Math.min(startX, endX),
		startY: Math.min(startY, endY),
		endX: Math.max(startX, endX),
		endY: Math.max(startY, endY),
		width: Math.round(width),
		height: Math.round(height),
		diagonal: Math.round(diagonal * 10) / 10,
	};
}

/**
 * Convert pixels to rem
 */
export function pxToRem(px: number, base: number): string {
	return (px / base).toFixed(2);
}

/**
 * Format measurement value with unit
 */
export function formatValue(px: number, unit: 'px' | 'rem', remBase: number): string {
	if (unit === 'rem') {
		return `${pxToRem(px, remBase)}rem`;
	}
	return `${px}px`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
