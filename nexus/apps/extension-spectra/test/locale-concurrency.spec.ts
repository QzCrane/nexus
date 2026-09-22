import { afterEach, describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import {
	getOptionsDictionary,
	getPopupDictionary,
	clearLocaleCatalogCache,
	SUPPORTED_SPECTRA_LANGUAGES,
} from '../src/shared/i18n/catalog';
import { loadOptionsLocaleCatalog } from '../src/shared/i18n/options-catalog';
import { loadPopupLocaleCatalog } from '../src/shared/i18n/popup-catalog';
import { getOptionsDictionary as getRetryOptionsDictionary } from '../src/shared/i18n/catalog';
import { loadOptionsLocaleCatalog as loadRetryOptionsLocaleCatalog } from '../src/shared/i18n/options-catalog';
import {
	createLocaleSectionStore,
	loadLocaleSection,
	MAX_CACHED_LOCALE_SECTIONS,
} from '../src/shared/i18n/locale-sections';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalFetch = globalThis.fetch;

afterEach(() => {
	clearLocaleCatalogCache();
	globalThis.fetch = originalFetch;
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

function compressedSection(
	section: 'popup' | 'options' | 'actions',
	language: 'en-US' | 'fr-FR' | 'de-DE',
): Uint8Array {
	if (language === 'en-US') {
		const english = {
			popup: {
				presetAppliedToast: 'Applied {value}',
				settingsTitle: 'Settings',
			},
			options: { modal_save: 'Save' },
			actions: { gain_up: 'Gain up' },
		};
		return gzipSync(JSON.stringify(english[section]));
	}
	const localized = language === 'fr-FR'
		? {
			popup: ['Appliqué {value}', 'Paramètres'],
			options: ['Enregistrer'],
			actions: ['Augmenter'],
		}
		: {
			popup: ['Angewendet {value}', 'Einstellungen'],
			options: ['Speichern'],
			actions: ['Erhöhen'],
		};
	return gzipSync(JSON.stringify(localized[section]));
}

describe('locale catalog concurrency', () => {
	test('keeps both language-keyed results when loads complete out of order', async () => {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		let englishFetches = 0;
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/([^/]+)\.json\.gz$/u.exec(String(input));
			const section = match?.[1] as 'popup' | 'options' | 'actions';
			const language = match?.[2] as
				| 'en-US'
				| 'fr-FR'
				| 'de-DE';
			if (language === 'en-US') englishFetches += 1;
			if (language === 'fr-FR') await new Promise(resolve => setTimeout(resolve, 20));
			return new Response(compressedSection(section, language));
		}) as typeof fetch;

		await Promise.all([
			loadPopupLocaleCatalog('fr-FR'),
			loadPopupLocaleCatalog('de-DE'),
			loadOptionsLocaleCatalog('fr-FR'),
			loadOptionsLocaleCatalog('de-DE'),
		]);

		expect(getPopupDictionary('fr-FR').settingsTitle).toBe('Paramètres');
		expect(getPopupDictionary('de-DE').settingsTitle).toBe('Einstellungen');
		expect(getOptionsDictionary('fr-FR').modal_save).toBe('Enregistrer');
		expect(getOptionsDictionary('de-DE').modal_save).toBe('Speichern');
		expect(englishFetches).toBe(3);
	});

	test('retries a localized asset after serving one English fallback', async () => {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		let frenchFetches = 0;
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/([^/]+)\.json\.gz$/u.exec(String(input));
			const section = match?.[1] as 'popup' | 'options' | 'actions';
			const language = match?.[2] as
				| 'en-US'
				| 'fr-FR';
			if (section === 'options' && language === 'fr-FR') {
				frenchFetches += 1;
				if (frenchFetches === 1) return new Response(null, { status: 503 });
			}
			return new Response(compressedSection(section, language));
		}) as typeof fetch;

		await loadRetryOptionsLocaleCatalog('fr-FR');
		expect(getRetryOptionsDictionary('fr-FR').modal_save).toBe('Save');
		await loadRetryOptionsLocaleCatalog('fr-FR');
		expect(getRetryOptionsDictionary('fr-FR').modal_save).toBe('Enregistrer');
		expect(frenchFetches).toBe(2);
	});

	test('bounds section cache and releases every settled in-flight load', async () => {
		const store = createLocaleSectionStore();
		const english = { label: 'English' };
		const fetchSection = async (language: (typeof SUPPORTED_SPECTRA_LANGUAGES)[number]) => (
			language === 'en-US' ? english : [language]
		);

		for (const language of SUPPORTED_SPECTRA_LANGUAGES) {
			await loadLocaleSection(language, store, fetchSection);
			expect(store.loads.size).toBe(0);
			expect(store.cache.size).toBeLessThanOrEqual(MAX_CACHED_LOCALE_SECTIONS);
		}

		expect(store.cache.size).toBe(MAX_CACHED_LOCALE_SECTIONS);
		expect(store.english.cache).toEqual(english);
	});
});
