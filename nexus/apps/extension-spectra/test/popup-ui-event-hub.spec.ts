import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { subscribePopupTabUiEvents } from '../src/popup/ui-event-hub?hub-test';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('Popup UI event hub', () => {
	test('installs one runtime listener, routes by tab, and isolates subscriber failures', () => {
		let listener: ((message: unknown) => false) | null = null;
		let addCount = 0;
		let removeCount = 0;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					onMessage: {
						addListener: (next: (message: unknown) => false) => {
							listener = next;
							addCount += 1;
						},
						removeListener: () => { removeCount += 1; },
					},
				},
			},
		});
		const error = spyOn(console, 'error').mockImplementation(() => undefined);
		let delivered = 0;
		let otherTabDelivered = 0;
		const disposeThrowing = subscribePopupTabUiEvents(7, () => {
			throw new Error('subscriber failure');
		});
		const disposeHealthy = subscribePopupTabUiEvents(7, () => { delivered += 1; });
		const disposeOther = subscribePopupTabUiEvents(8, () => { otherTabDelivered += 1; });

		expect(addCount).toBe(1);
		listener?.({
			protocolVersion: 2,
			type: 'spectra.control.snapshot.changed',
			tabId: 7,
			documentId: 'document:hub',
			generation: 1,
			payload: {
				tabId: 7,
				documentId: 'document:hub',
				origin: 'https://media.example',
				generation: 1,
				revision: 0,
				activeMedia: null,
				activeVideo: null,
				fields: {},
			},
		});
		expect(delivered).toBe(1);
		expect(otherTabDelivered).toBe(0);
		expect(error).toHaveBeenCalledTimes(1);

		disposeThrowing();
		disposeHealthy();
		expect(removeCount).toBe(0);
		disposeOther();
		expect(removeCount).toBe(1);
		error.mockRestore();
	});
});
