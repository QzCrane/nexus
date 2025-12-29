// goal: QR Code generation and scanning core logic

import QRCode from 'qrcode';
import type { QRCodeOptions } from './types';
import { DEFAULT_OPTIONS, STORAGE_KEY, MAX_HISTORY } from './types';

/**
 * Generate QR code as data URL
 */
export async function generateQRCode(
	text: string,
	options: Partial<Omit<QRCodeOptions, 'text'>> = {}
): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	return QRCode.toDataURL(text, {
		width: opts.size,
		margin: opts.margin,
		errorCorrectionLevel: opts.errorCorrectionLevel,
		color: {
			dark: '#ffffff',
			light: '#00000000', // transparent bg for dark mode
		},
	});
}

/**
 * Save text to history (FIFO, max 10)
 */
export async function saveToHistory(text: string): Promise<string[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	const history: string[] = result[STORAGE_KEY] || [];

	// Remove duplicates, add to front
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
 * Download QR code as PNG
 */
export function downloadQRCode(dataUrl: string, filename: string): void {
	const link = document.createElement('a');
	link.href = dataUrl;
	link.download = `${filename}.png`;
	link.click();
}

/**
 * Copy QR code to clipboard
 */
export async function copyQRCodeToClipboard(dataUrl: string): Promise<boolean> {
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
