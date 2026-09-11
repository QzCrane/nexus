// goal: Color Palette core logic - extract colors from images

import type { ColorInfo } from './types';

// Extract colors from image
export function extractColorsFromImage(img: HTMLImageElement, maxColors = 8): ColorInfo[] {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) return [];

	if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) throw new RangeError('Palette size must be between 1 and 256');
	if (img.width <= 0 || img.height <= 0) throw new Error('Image has no decoded dimensions');
	// Scale down for performance
	const scale = Math.min(1, 100 / Math.max(img.width, img.height));
	canvas.width = Math.max(1, Math.round(img.width * scale));
	canvas.height = Math.max(1, Math.round(img.height * scale));

	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const pixels = imageData.data;

	return paletteFromPixels(pixels, maxColors);
}

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

// Load image from file
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decoding failed')); };
		img.src = url;
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
