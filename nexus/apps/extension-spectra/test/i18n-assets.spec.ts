import { afterEach, describe, expect, test } from 'bun:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createLocaleCatalogs,
	createLocaleSurfaceAssetCatalogs,
	writeI18nAssets,
} from '../scripts/i18n-assets';
import {
	decodeLocaleSection,
	SUPPORTED_SPECTRA_LANGUAGES,
	type EncodedLocaleSectionAsset,
} from '../src/shared/i18n/catalog';
import { clearActionsLocaleCatalogCache, loadActionsSection } from '../src/shared/i18n/actions-catalog';
import { clearOptionsLocaleCatalogCache, loadOptionsSection } from '../src/shared/i18n/options-catalog';
import { clearPopupLocaleCatalogCache, loadPopupSection } from '../src/shared/i18n/popup-catalog';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
});

function decodeGeneratedSection(
	asset: EncodedLocaleSectionAsset,
	english: Record<string, string>,
): Record<string, string> {
	if (!Array.isArray(asset) && Object.keys(asset).some((key) => !/^(?:0|[1-9]\d*)$/u.test(key))) {
		return asset;
	}
	return Array.isArray(asset)
		? Object.fromEntries(Object.keys(english).map((key, index) => [key, asset[index] ?? '']))
		: { ...english, ...decodeLocaleSection(asset, english) };
}

describe('generated locale surface assets', () => {
	test('keeps every supported translation while projecting one surface at a time', () => {
		const fullCatalogs = createLocaleCatalogs();
		const surfaceAssets = createLocaleSurfaceAssetCatalogs();
		const english = fullCatalogs['en-US'];
		expect(english).toBeDefined();

		for (const surface of ['popup', 'options', 'actions'] as const) {
			const englishSection = english?.[surface] ?? {};
			expect(Object.keys(surfaceAssets[surface])).toEqual([...SUPPORTED_SPECTRA_LANGUAGES]);
			for (const language of SUPPORTED_SPECTRA_LANGUAGES) {
				const projected = decodeGeneratedSection(surfaceAssets[surface][language], englishSection);
				expect(projected).toEqual(fullCatalogs[language]?.[surface]);
				expect(projected).not.toHaveProperty('popup');
				expect(projected).not.toHaveProperty('options');
				expect(projected).not.toHaveProperty('actions');
			}
		}
	});

	test('writes exactly nine locale files per surface with no legacy combined asset', () => {
		const directory = mkdtempSync(join(tmpdir(), 'spectra-i18n-assets-'));
		temporaryDirectories.push(directory);
		writeI18nAssets(directory);

		const root = join(directory, 'i18n');
		expect(readdirSync(root).sort()).toEqual(['actions', 'options', 'popup']);
		expect(readdirSync(root, { withFileTypes: true }).some((entry) => entry.isFile())).toBe(false);

		for (const surface of ['popup', 'options', 'actions'] as const) {
			const surfaceDirectory = join(root, surface);
			expect(readdirSync(surfaceDirectory).sort()).toEqual(
				SUPPORTED_SPECTRA_LANGUAGES.map((language) => `${language}.json.gz`).sort(),
			);
			for (const language of SUPPORTED_SPECTRA_LANGUAGES) {
				const file = join(surfaceDirectory, `${language}.json.gz`);
				const decoded: unknown = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
				expect(typeof decoded).toBe('object');
				expect(decoded).not.toHaveProperty('popup');
				expect(decoded).not.toHaveProperty('options');
				expect(decoded).not.toHaveProperty('actions');
			}
		}
	});

	test('fetches only the asset owned by each surface', async () => {
		const requested: string[] = [];
		const originalFetch = globalThis.fetch;
		const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const gzipped = gzipSync(JSON.stringify({}));
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			requested.push(String(input));
			return new Response(gzipped);
		}) as typeof fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				runtime: {
					getURL: (path: string) => `chrome-extension://spectra-test/${path}`,
				},
			},
		});
		try {
			for (const [surface, load] of [
				['popup', loadPopupSection],
				['options', loadOptionsSection],
				['actions', loadActionsSection],
			] as const) {
				requested.length = 0;
				await load('en-US');
				expect(requested).toEqual([
					`chrome-extension://spectra-test/i18n/${surface}/en-US.json.gz`,
				]);
			}
		} finally {
			globalThis.fetch = originalFetch;
			if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
			else Reflect.deleteProperty(globalThis, 'chrome');
			clearPopupLocaleCatalogCache();
			clearOptionsLocaleCatalogCache();
			clearActionsLocaleCatalogCache();
		}
	});
});
