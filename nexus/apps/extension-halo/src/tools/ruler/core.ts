// goal: Ruler measurement logic

import type { RulerMeasurement } from './types';
import { STORAGE_KEY, DEFAULT_STATE } from './types';

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

/**
 * Save settings to storage
 */
export async function saveSettings(settings: { unit: 'px' | 'rem'; remBase: number }): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<{ unit: 'px' | 'rem'; remBase: number }> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	return result[STORAGE_KEY] || DEFAULT_STATE;
}
