// goal: Color conversion and manipulation utilities

import type { RGBColor, HSLColor, ColorInfo } from './types';
import { STORAGE_KEY, MAX_HISTORY } from './types';

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): RGBColor {
	const cleaned = hex.replace('#', '');
	const full = cleaned.length === 3
		? cleaned.split('').map(c => c + c).join('')
		: cleaned;

	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
	};
}

/**
 * RGB to Hex
 */
export function rgbToHex(rgb: RGBColor): string {
	const toHex = (n: number) => n.toString(16).padStart(2, '0');
	return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * RGB to HSL
 */
export function rgbToHsl(rgb: RGBColor): HSLColor {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;

	if (max === min) {
		return { h: 0, s: 0, l: Math.round(l * 100) };
	}

	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

	let h = 0;
	switch (max) {
		case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
		case g: h = ((b - r) / d + 2) / 6; break;
		case b: h = ((r - g) / d + 4) / 6; break;
	}

	return {
		h: Math.round(h * 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100),
	};
}

/**
 * Parse any color string to ColorInfo
 */
export function parseColor(input: string): ColorInfo | null {
	const trimmed = input.trim().toLowerCase();

	// Hex format
	if (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/.test(trimmed)) {
		const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
		const rgb = hexToRgb(hex);
		return { hex: hex.toLowerCase(), rgb, hsl: rgbToHsl(rgb) };
	}

	// RGB format: rgb(r, g, b)
	const rgbMatch = trimmed.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const rgb = { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
		return { hex: rgbToHex(rgb), rgb, hsl: rgbToHsl(rgb) };
	}

	return null;
}

/**
 * Get full ColorInfo from hex
 */
export function getColorInfo(hex: string): ColorInfo {
	const rgb = hexToRgb(hex);
	return { hex: hex.toLowerCase(), rgb, hsl: rgbToHsl(rgb) };
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
 * Save color to history
 */
export async function saveToHistory(hex: string): Promise<string[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	const history: string[] = result[STORAGE_KEY] || [];

	const filtered = history.filter(h => h !== hex);
	const updated = [hex, ...filtered].slice(0, MAX_HISTORY);

	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

/**
 * Load history from storage
 */
export async function loadHistory(): Promise<string[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	return result[STORAGE_KEY] || [];
}
