// goal: build deterministic, per-locale compressed catalogs outside runtime bundles

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { I18NDict } from '../src/popup/types';
import { createSourceLocaleCatalogs } from './i18n-source-catalog.ts';

const VALUE_MARKER = '__SPECTRA_I18N_VALUE__';

export interface EncodedLocaleCatalog {
	popup: Record<string, string>;
	options: Record<string, string>;
	actions: Record<string, string>;
}

export type EncodedLocaleSectionAsset = Record<string, string> | string[];

export type LocaleSurface = 'popup' | 'options' | 'actions';

export interface EncodedLocaleAssetCatalog {
	popup: EncodedLocaleSectionAsset;
	options: EncodedLocaleSectionAsset;
	actions: EncodedLocaleSectionAsset;
}

function encodePopupDictionary(dictionary: I18NDict): Record<string, string> {
	const encoded: Record<string, string> = {};
	for (const [key, value] of Object.entries(dictionary)) {
		encoded[key] = typeof value === 'function' ? value(VALUE_MARKER) : value;
	}
	return encoded;
}

export function createLocaleCatalogs(): Record<string, EncodedLocaleCatalog> {
	const catalogs: Record<string, EncodedLocaleCatalog> = {};
	for (const [language, catalog] of Object.entries(createSourceLocaleCatalogs())) {
		catalogs[language] = {
			popup: encodePopupDictionary(catalog.popup),
			options: catalog.options,
			actions: catalog.actions,
		};
	}
	return catalogs;
}

// English is the on-disk fallback baseline. Other locale assets only need the
// values that differ from it; the runtime rehydrates the complete schema after
// validating both files. This avoids storing the same fallback strings nine times.
export function createLocaleAssetCatalogs(): Record<string, EncodedLocaleAssetCatalog> {
	const catalogs = createLocaleCatalogs();
	const english = catalogs['en-US'];
	if (!english) throw new Error('English locale catalog is missing');
	return Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => {
		if (language === 'en-US') return [language, catalog];
		const asset = Object.fromEntries(
			(Object.keys(catalog) as Array<keyof EncodedLocaleCatalog>).map((section) => [
				section,
				encodeLocaleSection(catalog[section], english[section]),
			]),
		) as EncodedLocaleAssetCatalog;
		return [language, asset];
	}));
}

/**
 * Keep each extension page's asset closure limited to the sections it can
 * render.  The complete catalogs above remain the semantic source used by
 * tests; these assets are only an English baseline plus one section delta.
 */
export function createLocaleSurfaceAssetCatalogs(): Record<LocaleSurface, Record<string, EncodedLocaleSectionAsset>> {
	const catalogs = createLocaleCatalogs();
	const english = catalogs['en-US'];
	if (!english) throw new Error('English locale catalog is missing');
	const surfaces = ['popup', 'options', 'actions'] as const;
	return Object.fromEntries(surfaces.map((surface) => [
		surface,
		Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => [
			language,
			language === 'en-US'
				? catalog[surface]
				: encodeLocaleSection(catalog[surface], english[surface]),
		])),
	])) as Record<LocaleSurface, Record<string, EncodedLocaleSectionAsset>>;
}

function encodeLocaleSection(
	localized: Record<string, string>,
	english: Record<string, string>,
): EncodedLocaleSectionAsset {
	const keys = Object.keys(english);
	const changed = keys.flatMap((key, index) => (
		localized[key] !== english[key] ? [[index, localized[key]] as const] : []
	));
	// Dense arrays omit every repeated key. Sparse sections use English-key indexes
	// so partially translated locales do not pay for null placeholders.
	if (changed.length / keys.length > 0.7) return keys.map((key) => localized[key] ?? english[key] ?? '');
	return Object.fromEntries(changed.map(([index, value]) => [index, value ?? '']));
}

export function writeI18nAssets(distDir: string): void {
	const outputDir = resolve(distDir, 'i18n');
	const assets = createLocaleSurfaceAssetCatalogs();
	for (const surface of ['popup', 'options', 'actions'] as const) {
		const surfaceDir = resolve(outputDir, surface);
		mkdirSync(surfaceDir, { recursive: true });
		for (const [language, catalog] of Object.entries(assets[surface])) {
			const json = JSON.stringify(catalog);
			const compressed = gzipSync(json, { level: 9, mtime: 0 });
			writeFileSync(resolve(surfaceDir, `${language}.json.gz`), compressed);
		}
	}
}

export { VALUE_MARKER };
