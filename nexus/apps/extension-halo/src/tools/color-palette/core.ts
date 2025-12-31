// goal: Color Palette core logic - extract colors from images

import type { ColorInfo } from './types';

// Extract colors from image
export function extractColorsFromImage(img: HTMLImageElement, maxColors = 8): ColorInfo[] {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) return [];

	// Scale down for performance
	const scale = Math.min(1, 100 / Math.max(img.width, img.height));
	canvas.width = img.width * scale;
	canvas.height = img.height * scale;

	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const pixels = imageData.data;

	// Count colors (quantized)
	const colorMap = new Map<string, number>();
	for (let i = 0; i < pixels.length; i += 4) {
		const r = Math.round(pixels[i] / 32) * 32;
		const g = Math.round(pixels[i + 1] / 32) * 32;
		const b = Math.round(pixels[i + 2] / 32) * 32;
		const key = `${r},${g},${b}`;
		colorMap.set(key, (colorMap.get(key) || 0) + 1);
	}

	// Sort by count and take top colors
	const sorted = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, maxColors);
	const totalPixels = pixels.length / 4;

	return sorted.map(([rgb, count]) => {
		const [r, g, b] = rgb.split(',').map(Number);
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
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = URL.createObjectURL(file);
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
