import { browserReplayPolicy } from './browser-replay';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	githubEnvironmentLines,
	parseBrowserFloor,
	readBrowserFloor,
	validateProductMinimums,
} from './browser-floor';

describe('minimum Chrome evidence owner', () => {
	test('accepts the current exact Chrome for Testing artifact', () => {
		const floor = readBrowserFloor();
		expect(floor.minimumChromeMajor).toBe(135);
		expect(floor.chromeForTestingVersion).toBe('135.0.7049.114');
		expect(floor.linux64.sha256).toHaveLength(64);
		expect(githubEnvironmentLines(floor)).toContain('NEXUS_EXPECTED_CHROME_VERSION=135.0.7049.114');
	});

	test('rejects a replay browser from a different major', () => {
		const floor = structuredClone(readBrowserFloor());
		floor.chromeForTestingVersion = '136.0.0.0';
		expect(() => parseBrowserFloor(floor)).toThrow(/disagrees with replay/u);
	});

	test('rejects an unbound download location', () => {
		const floor = structuredClone(readBrowserFloor());
		floor.linux64.url = 'https://example.invalid/chrome.zip';
		expect(() => parseBrowserFloor(floor)).toThrow(/exact Chrome for Testing/u);
	});

	test('requires both products to declare the exact owned major', () => {
		const floor = readBrowserFloor();
		expect(validateProductMinimums(floor, { HALO: '135', SPECTRA: '135' })).toEqual([]);
		expect(validateProductMinimums(floor, { HALO: '135', SPECTRA: '136' }))
			.toEqual(['SPECTRA: expected minimum Chrome 135, got 136']);
	});
});

// Selection is explicit: an unavailable old driver must never silently fall back.
test('minimum-browser driver policy rejects implicit browser selection', () => {
	expect(() => browserReplayPolicy('135.0.7049.114', undefined, 'linux')).toThrow('exact executable');
	expect(browserReplayPolicy('135.0.7049.114', '/browser/chrome', 'linux')).toEqual({ driver: 'floor', args: ['--disable-gpu'] });
	expect(browserReplayPolicy('135.0.7049.114', 'C:/chrome.exe', 'win32')).toEqual({ driver: 'floor', args: [] });
	expect(browserReplayPolicy(undefined, undefined, 'linux')).toEqual({ driver: 'current', args: [] });
});

// Keep the supported Chrome-floor CDP implementation, not its vulnerable old
// download manager. The override is an explicit, browser-tested compatibility
// decision, not an advisory suppression or a change to the product runtime.
test('floor and current CDP drivers share the reviewed manager without the vulnerable extractor', () => {
	const workspace = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const spectra = JSON.parse(readFileSync(new URL('../apps/extension-spectra/package.json', import.meta.url), 'utf8'));
	const lock = Bun.JSONC.parse(readFileSync(new URL('../bun.lock', import.meta.url), 'utf8')) as {
		packages: Record<string, [string, ...unknown[]]>;
		overrides: Record<string, string>;
	};
	const manager = workspace.overrides['@puppeteer/browsers'];
	expect(manager).toMatch(/^\d+\.\d+\.\d+$/u);
	expect(lock.overrides['@puppeteer/browsers']).toBe(manager);
	expect(Object.values(lock.packages).filter(([name]) => name.startsWith('@puppeteer/browsers@')))
		.toEqual([lock.packages['@puppeteer/browsers']]);
	expect(lock.packages['@puppeteer/browsers']?.[0]).toBe(`@puppeteer/browsers@${manager}`);
	expect(spectra.devDependencies['puppeteer-floor']).toMatch(/^npm:puppeteer-core@\d+\.\d+\.\d+$/u);
	expect(lock.packages['puppeteer-floor']?.[0]).toBe(spectra.devDependencies['puppeteer-floor'].slice(4));
	expect(Object.values(lock.packages).some(([name]) => name.startsWith('extract-zip@'))).toBe(false);
});
