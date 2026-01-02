// goal: QR Code utilities (History, Clipboard, Download)

import { STORAGE_KEY, MAX_HISTORY } from './types';

export async function saveToHistory(text: string): Promise<string[]> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	const history: string[] = result[STORAGE_KEY] || [];
	const updated = [text, ...history.filter(h => h !== text)].slice(0, MAX_HISTORY);
	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

export async function loadHistory(): Promise<string[]> {
	return (await chrome.storage.local.get([STORAGE_KEY]))[STORAGE_KEY] || [];
}

export async function clearHistory(): Promise<void> {
	await chrome.storage.local.remove([STORAGE_KEY]);
}

export function downloadQRCode(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url; link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
	try {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return true;
	} catch { return false; }
}
