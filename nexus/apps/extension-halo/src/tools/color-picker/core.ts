// goal: Color conversion and manipulation utilities with CMYK and WCAG support

import type { RGBColor, HSLColor, CMYKColor, ColorInfo, ContrastResult } from './types';
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
 * RGB to CMYK
 */
export function rgbToCmyk(rgb: RGBColor): CMYKColor {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;

	const k = 1 - Math.max(r, g, b);
	if (k === 1) {
		return { c: 0, m: 0, y: 0, k: 100 };
	}

	const c = (1 - r - k) / (1 - k);
	const m = (1 - g - k) / (1 - k);
	const y = (1 - b - k) / (1 - k);

	return {
		c: Math.round(c * 100),
		m: Math.round(m * 100),
		y: Math.round(y * 100),
		k: Math.round(k * 100),
	};
}

/**
 * Calculate relative luminance (WCAG)
 */
export function getLuminance(rgb: RGBColor): number {
	const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(v => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
}

/**
 * Calculate contrast ratio between two colors
 */
export function getContrast(color1: RGBColor, color2: RGBColor): ContrastResult {
	const l1 = getLuminance(color1);
	const l2 = getLuminance(color2);
	const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

	return {
		ratio: Number(ratio.toFixed(2)),
		ratingAA: ratio >= 4.5 ? 'pass' : 'fail',
		ratingAAA: ratio >= 7 ? 'pass' : 'fail',
		ratingAALarge: ratio >= 3 ? 'pass' : 'fail',
		ratingAAALarge: ratio >= 4.5 ? 'pass' : 'fail',
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
		return { hex: hex.toLowerCase(), rgb, hsl: rgbToHsl(rgb), cmyk: rgbToCmyk(rgb) };
	}

	// RGB format: rgb(r, g, b)
	const rgbMatch = trimmed.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const [, red, green, blue] = rgbMatch;
		if (red === undefined || green === undefined || blue === undefined) return null;
		const rgb = { r: +red, g: +green, b: +blue };
		return { hex: rgbToHex(rgb), rgb, hsl: rgbToHsl(rgb), cmyk: rgbToCmyk(rgb) };
	}

	return null;
}

/**
 * Get full ColorInfo from hex
 */
export function getColorInfo(hex: string): ColorInfo {
	const rgb = hexToRgb(hex);
	return { hex: hex.toLowerCase(), rgb, hsl: rgbToHsl(rgb), cmyk: rgbToCmyk(rgb) };
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
