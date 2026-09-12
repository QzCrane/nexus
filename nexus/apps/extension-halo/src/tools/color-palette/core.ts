// goal: Color Palette core logic - extract colors from images

import type { ColorInfo } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const colorPaletteCodec: ToolStateCodec<ColorInfo[]> = {
	decode(value) {
		const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
			&& (value as Record<string, unknown>).version === 1
			? (value as Record<string, unknown>).value
			: value;
		if (!Array.isArray(raw) || raw.length > 256) return { kind: 'invalid', reason: 'Stored palette must be an array with at most 256 colors.' };
		const colors: ColorInfo[] = [];
		for (const item of raw) {
			if (typeof item !== 'object' || item === null || Array.isArray(item)) return { kind: 'invalid', reason: 'Stored palette contains a non-color value.' };
			const color = item as Record<string, unknown>;
			if (typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color.hex) || typeof color.rgb !== 'string'
				|| !Number.isSafeInteger(color.count) || (color.count as number) < 0
				|| !Number.isFinite(color.percentage) || (color.percentage as number) < 0 || (color.percentage as number) > 100) {
				return { kind: 'invalid', reason: 'Stored palette has invalid color, count, or percentage fields.' };
			}
			colors.push({ hex: color.hex, rgb: color.rgb, count: color.count as number, percentage: color.percentage as number });
		}
		return { kind: 'valid', value: colors };
	},
	encode(value) { return { version: 1, value }; },
};

// Count visible pixels only. Alpha is not a hidden black background; partial
// alpha retains the source color, and fully transparent pixels have no vote.
export function paletteFromPixels(pixels: Uint8ClampedArray, maxColors = 8): ColorInfo[] {
	if (pixels.length % 4 !== 0 || !Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
		throw new RangeError('Invalid RGBA pixels or palette size');
	}
	let totalPixels = 0;
	const colorMap = new Map<string, number>();
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i + 3] === 0) continue;
		totalPixels++;
		const red = pixels[i];
		const green = pixels[i + 1];
		const blue = pixels[i + 2];
		if (red === undefined || green === undefined || blue === undefined) break;
		const r = Math.min(255, Math.round(red / 32) * 32);
		const g = Math.min(255, Math.round(green / 32) * 32);
		const b = Math.min(255, Math.round(blue / 32) * 32);
		const key = `${r},${g},${b}`;
		colorMap.set(key, (colorMap.get(key) || 0) + 1);
	}

	// Sort by count and take top colors
	const sorted = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, maxColors);


	return sorted.map(([rgb, count]) => {
		const [r, g, b] = rgb.split(',').map(Number);
		if (r === undefined || g === undefined || b === undefined) return { hex: '#000000', rgb: 'rgb(0,0,0)', count, percentage: 0 };
		return {
			hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
			rgb: `rgb(${r}, ${g}, ${b})`,
			count,
			percentage: Math.round((count / totalPixels) * 100),
		};
	});
}

// Get contrast color (black or white)
export function getContrastColor(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.5 ? '#000000' : '#ffffff';
}
