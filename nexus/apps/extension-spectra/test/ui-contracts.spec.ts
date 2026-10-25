import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { formatKeyCombo, parseParams } from '../src/options/formatters';
import { EDITABLE_HOTKEY_ACTIONS, LEGACY_UNSUPPORTED_ACTIONS } from '../src/options/supported-hotkey-actions';
import {
	clearLocaleCatalogCache,
	getActionName as getLoadedActionName,
	getOptionsDictionary,
	getPopupDictionary,
	SUPPORTED_SPECTRA_LANGUAGES,
} from '../src/shared/i18n/catalog';
import { loadOptionsLocaleCatalog } from '../src/shared/i18n/options-catalog';
import { loadPopupLocaleCatalog } from '../src/shared/i18n/popup-catalog';
import {
	createLocaleAssetCatalogs,
	createLocaleCatalogs,
	createLocaleSurfaceAssetCatalogs,
} from '../scripts/i18n-assets';
import { getContentOSDMessages } from '../src/shared/i18n/content-osd';
import { withAlpha } from '../src/popup/visualizer/draw-eq-curve';

describe('hotkey editor contract', () => {
	test('only exposes actions with runtime handlers', () => {
		expect(EDITABLE_HOTKEY_ACTIONS.has('gain_up')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('ab_skip')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('fx_toggle')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('open_popup')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('pitch_up')).toBe(false);
		expect(LEGACY_UNSUPPORTED_ACTIONS.has('pitch_reset')).toBe(true);
	});

	test('rejects unsafe URL protocols and out-of-range values', () => {
		expect(parseParams('open_url', 'javascript:alert(1)')).toBeUndefined();
		expect(parseParams('open_url', 'https://example.com/a')).toEqual({ url: 'https://example.com/a' });
		expect(parseParams('speed_set', '17')).toBeUndefined();
		expect(parseParams('volume_set', '-1')).toBeUndefined();
		expect(parseParams('volume_set', '')).toBeUndefined();
		expect(parseParams('volume_set', '   ')).toBeUndefined();
		expect(parseParams('volume_set', '0')).toEqual({ volume: 0 });
		expect(parseParams('volume_set', '800')).toEqual({ volume: 800 });
		expect(parseParams('volume_set', '801')).toBeUndefined();
	});

	test('formats physical key codes accessibly', () => {
		expect(formatKeyCombo({
			code: 'KeyK',
			modifiers: { ctrl: true, alt: false, shift: true, meta: false },
		})).toBe('Ctrl + Shift + K');
	});
});

describe('popup visualizer color contract', () => {
	test('applies alpha to canonical hex and rgb theme colors', () => {
		expect(withAlpha('#2563eb', 0.25)).toBe('rgba(37, 99, 235, 0.250)');
		expect(withAlpha('rgb(37, 99, 235)', 0.5)).toBe('rgba(37, 99, 235, 0.500)');
		expect(withAlpha('#12345678', 0.5)).toBe('rgba(18, 52, 86, 0.235)');
	});
});

describe('options translations', () => {
	test('localizes reserved chords and describes every disabled shortcut truthfully', () => {
		const catalogs = createLocaleCatalogs();
		for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP'] as const) {
			const options = catalogs[locale]?.options;
			expect(options?.modal_reserved_default_hotkey.trim(), locale).not.toBe('');
			expect(options?.legacy_disabled_one.trim(), locale).not.toBe('');
			expect(options?.legacy_disabled_many.trim(), locale).not.toBe('');
		}
		expect(catalogs['en-US']?.options.legacy_disabled_one).not.toMatch(/Pitch/iu);
		expect(catalogs['en-US']?.options.legacy_pitch_one).toBeUndefined();
	});

	test('every supported locale resolves the complete shared schema', () => {
		const catalogs = createLocaleCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		const popupKeys = Object.keys(english.popup).sort();
		const optionsKeys = Object.keys(english.options).sort();
		const actionKeys = Object.keys(english.actions).sort();
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
			const dictionary = catalogs[locale];
			if (!dictionary) throw new Error(`${locale} locale catalog is missing`);
			expect(Object.keys(dictionary.popup).sort(), `${locale} popup`).toEqual(popupKeys);
			expect(Object.keys(dictionary.options).sort(), `${locale} options`).toEqual(optionsKeys);
			expect(Object.keys(dictionary.actions).sort(), `${locale} actions`).toEqual(actionKeys);
			for (const [section, values] of Object.entries(dictionary)) {
				for (const [key, value] of Object.entries(values)) {
					expect(typeof value, `${locale}.${section}.${key}`).toBe('string');
					expect(value.trim(), `${locale}.${section}.${key}`).not.toBe('');
					expect(value.trim().toLowerCase(), `${locale}.${section}.${key}`).not.toBe('undefined');
				}
			}
		}
	});

	test('every non-English locale contributes translations and Traditional Chinese is independent', () => {
		const catalogs = createLocaleCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES.filter((language) => language !== 'en-US')) {
			const dictionary = catalogs[locale];
			if (!dictionary) throw new Error(`${locale} locale catalog is missing`);
			for (const section of ['popup', 'options', 'actions'] as const) {
				const translated = Object.keys(english[section]).some(
					(key) => dictionary[section][key] !== english[section][key],
				);
				expect(translated, `${locale} ${section} must not be an all-English fallback`).toBe(true);
			}
		}
		expect(catalogs['zh-TW']).not.toEqual(catalogs['zh-CN']);
		expect(catalogs['zh-TW']?.popup.settingsTitle).toBe('設定');
		expect(catalogs['zh-TW']?.options.modal_save).toBe('儲存');
	});

	test('stores non-English locale assets as lossless English deltas', () => {
		const catalogs = createLocaleCatalogs();
		const assets = createLocaleAssetCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		expect(assets['en-US']).toEqual(english);
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES.filter((language) => language !== 'en-US')) {
			const asset = assets[locale];
			const complete = catalogs[locale];
			if (!asset || !complete) throw new Error(`${locale} locale catalog is missing`);
			for (const section of ['popup', 'options', 'actions'] as const) {
				const keys = Object.keys(english[section]);
				const encoded = asset[section];
				const delta = Array.isArray(encoded)
					? Object.fromEntries(keys.map((key, index) => [key, encoded[index]]))
					: Object.fromEntries(Object.entries(encoded).map(([index, value]) => [
						keys[Number(index)],
						value,
					]));
				expect({ ...english[section], ...delta }, `${locale} ${section}`).toEqual(
					complete[section],
				);
			}
		}
		expect(Array.isArray(assets['zh-CN']?.popup)).toBe(true);
		expect(Array.isArray(assets['ja-JP']?.options)).toBe(false);
	});

	test('keeps the requested locale readable when its asset falls back to English', async () => {
		clearLocaleCatalogCache();
		const assets = createLocaleSurfaceAssetCatalogs();
		const english = createLocaleCatalogs()['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/en-US\.json\.gz$/u.exec(String(input));
			const surface = match?.[1] as keyof typeof assets | undefined;
			const asset = surface ? assets[surface]['en-US'] : undefined;
			return asset
				? new Response(gzipSync(JSON.stringify(asset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 });
		}) as typeof fetch;
		try {
			await loadOptionsLocaleCatalog('fr-FR');
			await loadPopupLocaleCatalog('fr-FR');
			expect(getPopupDictionary('fr-FR').settingsTitle).toBe(english.popup.settingsTitle);
			expect(getOptionsDictionary('fr-FR').modal_save).toBe(english.options.modal_save);
			expect(getLoadedActionName('gain_up', 'fr-FR')).toBe(english.actions.gain_up);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
			else {
				Object.defineProperty(globalThis, 'chrome', {
					configurable: true,
					value: originalChrome,
				});
			}
		}
	});

	test('validates, expands, and hydrates generated locale assets at runtime', async () => {
		clearLocaleCatalogCache();
		const assets = createLocaleSurfaceAssetCatalogs();
		const complete = createLocaleCatalogs();
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/([^/]+)\.json\.gz$/u.exec(String(input));
			const surface = match?.[1] as keyof typeof assets | undefined;
			const language = match?.[2];
			const asset = surface && language ? assets[surface][language] : undefined;
			return asset
				? new Response(gzipSync(JSON.stringify(asset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 });
		}) as typeof fetch;
		try {
			for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
				await Promise.all([
					loadOptionsLocaleCatalog(locale),
					loadPopupLocaleCatalog(locale),
				]);
				expect(getPopupDictionary(locale).settingsTitle, `${locale} popup`).toBe(
					complete[locale]?.popup.settingsTitle,
				);
				expect(getOptionsDictionary(locale).modal_save, `${locale} options`).toBe(
					complete[locale]?.options.modal_save,
				);
				expect(getLoadedActionName('gain_up', locale), `${locale} actions`).toBe(
					complete[locale]?.actions.gain_up,
				);
			}
		} finally {
			globalThis.fetch = originalFetch;
			if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
			else {
				Object.defineProperty(globalThis, 'chrome', {
					configurable: true,
					value: originalChrome,
				});
			}
		}
	});

	test('resolves only the current Content OSD strings with an English fallback', () => {
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
			expect(getContentOSDMessages(locale).muted.length, locale).toBeGreaterThan(0);
		}
		expect(getContentOSDMessages('unsupported')).toMatchObject({ muted: 'MUTE' });
		expect(getContentOSDMessages('zh-CN')).toMatchObject({ muted: '静音' });
	});

	test('offers every supported locale in both extension UIs', () => {
		for (const [file, selectId] of [
			['../public/popup.html', 'set-lang'],
			['../public/options.html', 'lang-select'],
		] as const) {
			const html = readFileSync(resolve(import.meta.dir, file), 'utf8');
			const select = new RegExp(`<select[^>]+id=["']${selectId}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'u').exec(html)?.[1];
			expect(select, file).toBeDefined();
			const values = [...(select ?? '').matchAll(/<option\s+value=["']([^"']+)["']/gu)]
				.map((match) => match[1]);
			expect(values, file).toEqual([...SUPPORTED_SPECTRA_LANGUAGES]);
		}
	});
});

describe('extension-page physical artifacts', () => {
	test('defines every CSS variable and keeps keyframes unique', () => {
		for (const file of ['../public/popup.css', '../public/options.css']) {
			const css = readFileSync(resolve(import.meta.dir, file), 'utf8');
			const definitions = new Set([...css.matchAll(/--([A-Za-z0-9_-]+)\s*:/gu)].map((match) => match[1]));
			const uses = [...css.matchAll(/var\(--([A-Za-z0-9_-]+)/gu)].map((match) => match[1]);
			expect(uses.filter((name) => !definitions.has(name)), file).toEqual([]);
			const keyframes = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/gu)].map((match) => match[1]);
			expect(new Set(keyframes).size, file).toBe(keyframes.length);
		}
	});

	test('gives every popup range control an accessible name', () => {
		const html = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		const rangeInputs = html.match(/<input\b(?=[^>]*\btype=["']range["'])[^>]*>/giu) ?? [];
		expect(rangeInputs.length).toBeGreaterThan(0);
		for (const input of rangeInputs) {
			expect(input).toMatch(/\baria-(?:label|labelledby)=["'][^"']+["']/iu);
		}
	});
});
