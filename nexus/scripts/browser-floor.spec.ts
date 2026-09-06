import { browserReplayPolicy } from './browser-replay';
import { describe, expect, test } from 'bun:test';
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
