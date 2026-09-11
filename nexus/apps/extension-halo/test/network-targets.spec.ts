import { afterEach, describe, expect, test } from 'bun:test';
import { isPrivateHost } from '../src/kernel/utils/ssrf-guard';
import { getTranslateUrl } from '../src/tools/translate/core';
import { deleteCookie, setCookie, cookieUrl } from '../src/tools/cookie-manager/core';
import type { CookieInfo } from '../src/tools/cookie-manager/types';
import { scanActiveTabStorage, setStorageItem, type StorageSnapshot } from '../src/tools/storage-editor/core';
import { executeRequest } from '../src/tools/api-tester/core';
import { DEFAULT_CONFIG } from '../src/tools/api-tester/core';

const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

afterEach(() => {
	for (const [property, descriptor] of [['chrome', previousChrome], ['fetch', previousFetch]] as const) {
		if (descriptor) Object.defineProperty(globalThis, property, descriptor);
		else Reflect.deleteProperty(globalThis, property);
	}
});

function cookie(overrides: Partial<CookieInfo> = {}): CookieInfo {
	return {
		name: 'sid',
		value: 'v',
		domain: '.example.com',
		path: '/',
		expires: 1234,
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		hostOnly: false,
		session: false,
		storeId: '1',
		partitionKey: undefined,
		...overrides,
	};
}

describe('ssrf guard literals and false positives', () => {
	test('short, octal, hex, decimal and mapped literals are private', () => {
		for (const host of [
			'127.1',
			'127.0.0.1',
			'0177.0.0.1',
			'0x7f.0.0.1',
			'2130706433',
			'127.0.0.1.',
			'10.0.0.1',
			'100.100.1.1',
			'169.254.1.1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'fe80::1',
			'fe80::1%eth0',
			'fd00::1',
		]) expect(isPrivateHost(host), host).toBe(true);
	});

	test('hostnames that merely look numeric are no longer blocked', () => {
		for (const host of [
			'10.0.0.1.com',
			'127.0.0.1.evil.test',
			'192.168.company.com',
			'0.1.2.3.public.example',
		]) expect(isPrivateHost(host), host).toBe(false);
	});

	test('public addresses stay reachable', () => {
		for (const host of ['example.com', '8.8.8.8', '100.63.0.1', '172.32.0.1', '198.51.101.1', '198.20.1.1', '2606:4700::1']) {
			expect(isPrivateHost(host), host).toBe(false);
		}
	});
});

describe('cookie identity preservation', () => {
	test('cookieUrl derives scheme, host and path from the cookie itself', () => {
		expect(cookieUrl(cookie())).toBe('https://example.com/');
		expect(cookieUrl(cookie({ secure: false, domain: 'host.example', path: '/a' }))).toBe('http://host.example/a');
	});

	test('setCookie targets the cookie origin and keeps host-only identity', async () => {
		const seen: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { cookies: { set: async (details: unknown) => { seen.push(details); return {} as chrome.cookies.Cookie; } } },
		});
		await setCookie(cookie());
		expect(seen[0]).toMatchObject({ url: 'https://example.com/', name: 'sid', storeId: '1' });
		// A domain cookie keeps its domain attribute.
		expect((seen[0] as Record<string, unknown>).domain).toBe('.example.com');

		await setCookie(cookie({ hostOnly: true, domain: 'example.com', storeId: undefined }));
		expect((seen[1] as Record<string, unknown>).domain).toBeUndefined();
		expect((seen[1] as Record<string, unknown>).storeId).toBeUndefined();
	});

	test('deleteCookie carries store and partition identity', async () => {
		const seen: unknown[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { cookies: { remove: async (details: unknown) => { seen.push(details); return {} as chrome.cookies.Cookie; } } },
		});
		await deleteCookie(cookie({ partitionKey: { topLevelSite: 'https://example.com' } }));
		expect(seen[0]).toMatchObject({
			url: 'https://example.com/',
			name: 'sid',
			storeId: '1',
			partitionKey: { topLevelSite: 'https://example.com' },
		});
	});
});

describe('storage editor target binding', () => {
	const snapshot: StorageSnapshot = { tabId: 11, origin: 'https://site.example', items: [] };

	function installTabs(currentUrl: string) {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				tabs: {
					get: async () => ({ id: 11, url: currentUrl }),
					query: async () => [{ id: 11, url: currentUrl, title: 'Site' }],
				},
				scripting: {
					// The page-side reader returns an empty inventory.
					executeScript: async () => [{ result: [] }],
				},
			},
		});
	}

	test('scan binds to the scanned origin', async () => {
		installTabs('https://site.example/page');
		const scan = await scanActiveTabStorage();
		expect(scan.tabId).toBe(11);
		expect(scan.origin).toBe('https://site.example');
	});

	test('a mutation into a tab that left the scanned origin fails explicitly', async () => {
		installTabs('https://other.example/page');
		await expect(setStorageItem('k', 'v', 'localStorage', snapshot)).rejects.toThrow('Rescan');
	});

	test('a same-origin tab accepts the mutation', async () => {
		installTabs('https://site.example/other-page');
		await expect(setStorageItem('k', 'v', 'localStorage', snapshot)).resolves.toBeUndefined();
	});
});

describe('translate receiver fidelity', () => {
	test('DeepL page translation is refused instead of silently proxied to Google', () => {
		expect(() => getTranslateUrl('deepl', 'https://page.example')).toThrow('DeepL');
		expect(getTranslateUrl('google', 'https://page.example')).toContain('translate.google.com');
		expect(getTranslateUrl('bing', 'https://page.example')).toContain('translatetheweb.com');
	});
});

describe('api tester response budgets', () => {
	test('a response above the byte budget is rejected explicitly', async () => {
		const bigBody = 'x'.repeat(64 * 1024);
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: async () => new Response(bigBody, { status: 200 }),
		});
		await expect(executeRequest(
			{ ...DEFAULT_CONFIG, url: 'https://public.example/data' },
			{ maxBytes: 1024 },
		)).rejects.toThrow('byte budget');
	});

	test('a bounded response round-trips with its encoded size', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
		});
		const result = await executeRequest({ ...DEFAULT_CONFIG, url: 'https://public.example/api' });
		expect(result.status).toBe(200);
		expect(result.body).toBe('{"ok":true}');
		expect(result.size).toBe(11);
	});
});
