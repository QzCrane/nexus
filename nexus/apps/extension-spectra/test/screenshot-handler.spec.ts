import { afterEach, describe, expect, test } from 'bun:test';
import { screenshotHandlerTestApi } from '../src/background/handlers/screenshot';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');

afterEach(() => {
	restore('chrome', originalChrome);
	restore('createImageBitmap', originalBitmap);
	restore('OffscreenCanvas', originalCanvas);
});

describe('Chrome-native screenshot acknowledgement', () => {
	test('fails before capture when optional Downloads permission is absent', async () => {
		let tabApiTouched = false;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				permissions: { contains: async () => false },
				tabs: {
					query: async () => { tabApiTouched = true; return []; },
				},
			},
		});
		await expect(screenshotHandlerTestApi.captureAndSaveWithGrantedPermission(
			{ id: 7, windowId: 3, active: true } as chrome.tabs.Tab,
			{
				captureToken: 'capture-token-denied',
				rect: {
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					viewportWidth: 10,
					viewportHeight: 10,
				},
			},
			async () => undefined,
		)).rejects.toThrow('Downloads permission');
		expect(tabApiTouched).toBe(false);
	});

	test('does not report saved until Chrome confirms download completion', async () => {
		let downloadListener: ((delta: chrome.downloads.DownloadDelta) => void) | null = null;
		let targetVerificationCount = 0;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: {
					query: async () => [{ id: 7, windowId: 3, active: true }],
					captureVisibleTab: async () => 'data:image/png;base64,iVBORw0KGgo=',
				},
				downloads: {
					download: async () => 41,
					search: async () => [{ id: 41, state: 'in_progress' }],
					onChanged: {
						addListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) => {
							downloadListener = listener;
						},
						removeListener: () => { downloadListener = null; },
					},
				},
			},
		});
		Object.defineProperty(globalThis, 'createImageBitmap', {
			configurable: true,
			value: async () => ({ width: 200, height: 100, close: () => undefined }),
		});
		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true,
			value: class FakeOffscreenCanvas {
				constructor(readonly width: number, readonly height: number) { }
				getContext(): { drawImage: () => void } {
					return { drawImage: () => undefined };
				}
				async convertToBlob(): Promise<Blob> {
					return new Blob(['png'], { type: 'image/png' });
				}
			},
		});

		let settled = false;
		const pending = screenshotHandlerTestApi.captureAndSave(
			{ id: 7, windowId: 3, active: true } as chrome.tabs.Tab,
			{
				captureToken: 'capture-token-41',
				rect: {
					x: 10,
					y: 5,
					width: 100,
					height: 50,
					viewportWidth: 200,
					viewportHeight: 100,
				},
			},
			async () => { targetVerificationCount += 1; },
		).finally(() => { settled = true; });
		for (let attempt = 0; attempt < 20 && !downloadListener; attempt += 1) {
			await Promise.resolve();
		}
		expect(downloadListener).not.toBeNull();
		expect(settled).toBe(false);
		expect(targetVerificationCount).toBe(2);

		downloadListener?.({ id: 41, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
		expect(await pending).toEqual({
			saved: true,
			method: 'capture-visible-tab',
			width: 100,
			height: 50,
		});
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
