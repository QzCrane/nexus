
// goal: Screenshot capture logic
// scope: module

import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const screenshotDelayCodec: ToolStateCodec<number> = {
	decode(value) { return value === 0 || value === 3 || value === 5 || value === 10 ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Screenshot delay must be 0, 3, 5, or 10 seconds.' }; },
	encode(value) { return value; },
};

export interface VisibleCaptureTarget {
	tabId: number;
	windowId: number;
	url: string;
}

export async function bindVisibleCaptureTarget(): Promise<VisibleCaptureTarget> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined || tab.windowId === undefined || !tab.url) throw new Error('No capturable active tab');
	return { tabId: tab.id, windowId: tab.windowId, url: tab.url };
}

async function requireBoundTargetActive(target: VisibleCaptureTarget): Promise<void> {
	const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
	if (active?.id !== target.tabId || active.url !== target.url) {
		throw new Error('The selected page changed. Start a new capture.');
	}
}

// captureVisibleTab cannot atomically bind a document. Verify the click-bound
// tab immediately before and after capture and discard a result after any race.
export async function captureBoundVisible(target: VisibleCaptureTarget): Promise<string> {
	await requireBoundTargetActive(target);
	const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, { format: 'png' });
	await requireBoundTargetActive(target);
	return dataUrl;
}

// Download the data URL as a file
export function downloadScreenshot(dataUrl: string, filename: string = 'screenshot.png') {
	const link = document.createElement('a');
	link.href = dataUrl;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

// Copy data URL (image) to clipboard
export async function copyToClipboard(dataUrl: string): Promise<boolean> {
	try {
		const res = await fetch(dataUrl);
		const blob = await res.blob();
		await navigator.clipboard.write([
			new ClipboardItem({ [blob.type]: blob })
		]);
		return true;
	} catch (err) {
		console.error('Copy failed', err);
		return false;
	}
}
