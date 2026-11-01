import { afterEach, describe, expect, test } from 'bun:test';
import {
	isActionPopupSender,
	isExtensionDocumentSender,
	isPopupDocumentSender,
} from '../src/background/popup-document-sender';
import { actionPopupPath } from '../src/shared/popup-bootstrap';

const EXTENSION_ID = 'spectra-test';
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

function installExtension(): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: {
			runtime: {
				id: EXTENSION_ID,
				getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
			},
		},
	});
}

function popupUrl(query = ''): string {
	return `chrome-extension://${EXTENSION_ID}/popup.html${query}`;
}

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('extension document sender identity', () => {
	test('accepts the Popup document the Background actually announces', () => {
		installExtension();
		// The regression this predicate exists for: `popup-frame` states the card
		// count in the Popup's own URL, so the document Chrome opens is not the
		// bare path the manifest names. Trusting the bytes rejected that document.
		for (const cards of [0, 1, 2, 7]) {
			const announced = chrome.runtime.getURL(actionPopupPath(cards));
			expect(announced).not.toBe(popupUrl());
			expect(isActionPopupSender({ id: EXTENSION_ID, url: announced })).toBe(true);
		}
		expect(isActionPopupSender({ id: EXTENSION_ID, url: popupUrl() })).toBe(true);
	});

	test('accepts a Popup document opened at a fragment or a different surface', () => {
		installExtension();
		expect(isActionPopupSender({ id: EXTENSION_ID, url: popupUrl('#view-settings') })).toBe(true);
		expect(isPopupDocumentSender({ id: EXTENSION_ID, url: popupUrl('?cards=2') })).toBe(true);
		// A tab-hosted copy is the same document and the same authority for
		// decisions it makes about itself, but it is not the Action Popup surface.
		expect(isPopupDocumentSender({ id: EXTENSION_ID, url: popupUrl(), tab: { id: 7 } })).toBe(true);
		expect(isActionPopupSender({ id: EXTENSION_ID, url: popupUrl(), tab: { id: 7 } })).toBe(false);
	});

	test('rejects another document of the same extension', () => {
		installExtension();
		for (const path of ['options.html', 'offscreen.html', 'background.js', 'popup.html.bak']) {
			expect(isExtensionDocumentSender({ id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/${path}` }, 'popup.html')).toBe(false);
		}
		// A nested path is a different document, not a variant of the Popup.
		expect(isActionPopupSender({ id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/nested/popup.html` })).toBe(false);
	});

	test('rejects Content and foreign origins even with the extension id', () => {
		installExtension();
		// A content script reports the page's URL, which cannot pass the origin test.
		expect(isActionPopupSender({
			id: EXTENSION_ID,
			url: 'https://media.example/one',
			tab: { id: 7 },
		})).toBe(false);
		// A page cannot present itself as an extension document.
		expect(isPopupDocumentSender({ id: EXTENSION_ID, url: 'https://media.example/popup.html' })).toBe(false);
		expect(isPopupDocumentSender({ id: 'other-extension', url: popupUrl() })).toBe(false);
		// A different extension hosting a same-named document is not this Popup.
		expect(isPopupDocumentSender({ id: 'other-extension', url: 'chrome-extension://other-extension/popup.html' })).toBe(false);
	});

	test('rejects senders that carry no readable identity', () => {
		installExtension();
		expect(isPopupDocumentSender(null)).toBe(false);
		expect(isPopupDocumentSender(undefined)).toBe(false);
		expect(isPopupDocumentSender({ id: EXTENSION_ID })).toBe(false);
		expect(isPopupDocumentSender({ id: EXTENSION_ID, url: 'not a url' })).toBe(false);
	});

	test('rejects every sender when the extension runtime is absent', () => {
		Reflect.deleteProperty(globalThis, 'chrome');
		expect(isPopupDocumentSender({ id: EXTENSION_ID, url: popupUrl() })).toBe(false);
		expect(isActionPopupSender({ id: EXTENSION_ID, url: popupUrl() })).toBe(false);
	});
});
