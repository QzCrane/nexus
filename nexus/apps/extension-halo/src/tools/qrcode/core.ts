// goal: QR Code generation (with Logo & Colors) and scanning core logic

import QRCode from 'qrcode';
import jsQR from 'jsqr';
import type { QRCodeOptions, ScanResult } from './types';
import { DEFAULT_OPTIONS, STORAGE_KEY, MAX_HISTORY } from './types';

/**
 * Generate QR code as data URL with Logo and Color support
 */
export async function generateQRCode(
	text: string,
	options: Partial<Omit<QRCodeOptions, 'text'>> = {}
): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	// 1. Generate QR Code on a canvas first to allow logo embedding
	const canvas = document.createElement('canvas');
	await QRCode.toCanvas(canvas, text, {
		width: opts.size,
		margin: opts.margin,
		errorCorrectionLevel: opts.errorCorrectionLevel,
		color: {
			dark: opts.darkColor,
			light: opts.lightColor,
		},
	});

	// 2. If logo exists, draw it in the center
	if (opts.logo) {
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const logoImg = new Image();
			logoImg.src = opts.logo;
			await new Promise((resolve) => {
				logoImg.onload = resolve;
				logoImg.onerror = resolve; // Continue even if logo fails
			});

			if (logoImg.complete && logoImg.width > 0) {
				const logoSize = opts.size * (opts.logoSize || 0.2);
				const x = (opts.size - logoSize) / 2;
				const y = (opts.size - logoSize) / 2;

				// Draw white background for logo (for readability)
				ctx.fillStyle = opts.lightColor;
				ctx.fillRect(x - 2, y - 2, logoSize + 4, logoSize + 4);

				ctx.drawImage(logoImg, x, y, logoSize, logoSize);
			}
		}
	}

	return canvas.toDataURL('image/png');
}

/**
 * Generate QR code as SVG string
 */
export async function generateSVG(
	text: string,
	options: Partial<Omit<QRCodeOptions, 'text'>> = {}
): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	return QRCode.toString(text, {
		type: 'svg',
		margin: opts.margin,
		errorCorrectionLevel: opts.errorCorrectionLevel,
		color: {
			dark: opts.darkColor,
			light: opts.lightColor,
		},
	});
}

/**
 * Scan QR code from image data
 */
export function scanQRCodeFromImageData(
	imageData: ImageData
): ScanResult | null {
	const code = jsQR(imageData.data, imageData.width, imageData.height);
	if (!code) return null;

	return {
		data: code.data,
		location: {
			topLeft: code.location.topLeftCorner,
			topRight: code.location.topRightCorner,
			bottomLeft: code.location.bottomLeftCorner,
			bottomRight: code.location.bottomRightCorner,
		},
	};
}

/**
 * Scan QR code from File (image)
 */
export async function scanQRCodeFromFile(file: File): Promise<ScanResult | null> {
	return new Promise((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);

		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				URL.revokeObjectURL(url);
				resolve(null);
				return;
			}

			ctx.drawImage(img, 0, 0);
			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const result = scanQRCodeFromImageData(imageData);

			URL.revokeObjectURL(url);
			resolve(result);
		};

		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};

		img.src = url;
	});
}

/**
 * Scan QR code from clipboard image
 */
export async function scanQRCodeFromClipboard(): Promise<ScanResult | null> {
	try {
		const items = await navigator.clipboard.read();
		for (const item of items) {
			const imageType = item.types.find(t => t.startsWith('image/'));
			if (imageType) {
				const blob = await item.getType(imageType);
				const file = new File([blob], 'clipboard.png', { type: imageType });
				return scanQRCodeFromFile(file);
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Save text to history (FIFO, max 10)
 */
export async function saveToHistory(text: string): Promise<string[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	const history: string[] = result[STORAGE_KEY] || [];

	const filtered = history.filter(h => h !== text);
	const updated = [text, ...filtered].slice(0, MAX_HISTORY);

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

/**
 * Clear history
 */
export async function clearHistory(): Promise<void> {
	await chrome.storage.local.remove([STORAGE_KEY]);
}

/**
 * Download QR code
 */
export function downloadQRCode(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

/**
 * Copy image to clipboard
 */
export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
	try {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		await navigator.clipboard.write([
			new ClipboardItem({ 'image/png': blob }),
		]);
		return true;
	} catch {
		return false;
	}
}
