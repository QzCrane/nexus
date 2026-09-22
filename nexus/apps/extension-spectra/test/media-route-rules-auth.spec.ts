import { afterEach, describe, expect, test } from 'bun:test';
import { isTrustedMediaRouteRulesSender } from '../src/background/handlers/registry';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('media route rules UI authority', () => {
	test('accepts the extension Popup in toolbar or extension-tab form and rejects Content', () => {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					id: 'spectra-test',
					getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
				},
			},
		});
		const popupUrl = chrome.runtime.getURL('popup.html');

		expect(isTrustedMediaRouteRulesSender({ id: 'spectra-test', url: popupUrl })).toBe(true);
		expect(isTrustedMediaRouteRulesSender({
			id: 'spectra-test',
			url: popupUrl,
			tab: { id: 7 } as chrome.tabs.Tab,
		})).toBe(true);
		expect(isTrustedMediaRouteRulesSender({
			id: 'spectra-test',
			url: 'https://www.douyin.com/follow/live',
			tab: { id: 7 } as chrome.tabs.Tab,
		})).toBe(false);
		expect(isTrustedMediaRouteRulesSender({ id: 'other-extension', url: popupUrl })).toBe(false);
		expect(isTrustedMediaRouteRulesSender({ id: 'spectra-test' })).toBe(false);
	});
});
