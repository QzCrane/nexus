import { afterEach, describe, expect, test } from 'bun:test';
import { bindVisibleCaptureTarget, captureBoundVisible } from '../src/tools/screenshot/core';

const originalChrome = globalThis.chrome;
afterEach(() => {
	Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
});

describe('screenshot target binding', () => {
	test('returns a capture only while the click-bound tab remains active before and after the effect', async () => {
		let queryCount = 0;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			writable: true,
			value: { tabs: {
				query: async () => { queryCount++; return [{ id: 7, windowId: 3, url: 'https://example.test/' }]; },
				captureVisibleTab: async () => 'data:image/png;base64,ok',
			} },
		});
		const target = await bindVisibleCaptureTarget();
		await expect(captureBoundVisible(target)).resolves.toBe('data:image/png;base64,ok');
		expect(queryCount).toBe(3);
	});

	test('discards a result if navigation wins the non-atomic capture race', async () => {
		let calls = 0;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			writable: true,
			value: { tabs: {
				query: async () => [{ id: 7, windowId: 3, url: ++calls === 1 ? 'https://before.test/' : 'https://after.test/' }],
				captureVisibleTab: async () => 'data:image/png;base64,wrong-document',
			} },
		});
		await expect(captureBoundVisible({ tabId: 7, windowId: 3, url: 'https://before.test/' }))
			.rejects.toThrow('selected page changed');
	});
});
