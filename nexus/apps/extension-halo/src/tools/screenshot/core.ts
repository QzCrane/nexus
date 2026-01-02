
// goal: Screenshot capture logic
// scope: module

// Capture the visible part of the active tab
export async function captureVisible(): Promise<string> {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tabs[0]?.id) throw new Error('No active tab');

	return await chrome.tabs.captureVisibleTab(tabs[0].windowId, {
		format: 'png'
	});
}

// Capture with delay (for positioning)
export async function captureWithDelay(delayMs: number): Promise<string> {
	await new Promise(resolve => setTimeout(resolve, delayMs));
	return captureVisible();
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
