// goal: load only the locale sections rendered by Popup

import type { SupportedLanguage } from '@nexus/contracts';
import type { I18NDict, I18NMap } from '../../popup/types';
import {
	cacheLocaleSection,
	cacheLocaleValue,
	clearLocaleSectionStore,
	createLocaleSectionStore,
	decodeLocaleSectionResponse,
	loadLocaleSection,
	normalizeLanguage,
	type EncodedLocaleSectionAsset,
} from './locale-sections';

const VALUE_MARKER = '__SPECTRA_I18N_VALUE__';
const FUNCTION_KEYS = [
	'presetAppliedToast',
] as const satisfies ReadonlyArray<keyof I18NDict>;
const popupStore = createLocaleSectionStore();
const hydratedPopupCache = new Map<SupportedLanguage, I18NDict>();

interface PopupCatalogWindow extends Window { __SPECTRA_POPUP_CATALOGS__?: I18NMap; }

/** Same packaged catalog, shared between the classic prepaint and module realm. */
export function installPrepaintPopupCatalogs(catalogs: I18NMap): void {
	(window as PopupCatalogWindow).__SPECTRA_POPUP_CATALOGS__ = catalogs;
}

function prepaintDictionary(language: SupportedLanguage): I18NDict | undefined {
	return typeof window === 'undefined' ? undefined : (window as PopupCatalogWindow).__SPECTRA_POPUP_CATALOGS__?.[language];
}

function fetchPopupSection(language: SupportedLanguage): Promise<EncodedLocaleSectionAsset> {
	return fetch(chrome.runtime.getURL(`i18n/popup/${language}.json.gz`))
		.then((response) => decodeLocaleSectionResponse(response, `Popup locale ${language}`));
}

function hydratePopup(encoded: Record<string, string>): I18NDict {
	const dictionary = { ...encoded } as unknown as I18NDict;
	for (const key of FUNCTION_KEYS) {
		const template = encoded[key];
		if (typeof template !== 'string') throw new Error(`Locale catalog is missing ${key}`);
		dictionary[key] = ((value: string) => template.replaceAll(VALUE_MARKER, value)) as never;
	}
	return dictionary;
}

export function storePopupCatalog(language: string, encoded: Record<string, string>): void {
	const normalized = normalizeLanguage(language);
	cacheLocaleSection(popupStore, normalized, encoded);
	const hydrated = hydratePopup(encoded);
	cacheLocaleValue(hydratedPopupCache, normalized, hydrated);
}

export function loadPopupSection(
	language: string,
	fetchSection: (language: SupportedLanguage) => Promise<EncodedLocaleSectionAsset> = fetchPopupSection,
): Promise<Record<string, string>> {
	return loadLocaleSection(language, popupStore, fetchSection);
}

export async function loadPopupLocaleCatalog(language: string): Promise<void> {
	if (prepaintDictionary(normalizeLanguage(language))) return;
	// Popup controls do not render Options' hotkey action labels. Keep the
	// action catalog owned by the Options surface so opening Popup cannot pull
	// all nine action assets into its eventual closure.
	const popup = await loadPopupSection(language);
	storePopupCatalog(language, popup);
}

export function getPopupDictionary(language: string): I18NDict {
	const normalized = normalizeLanguage(language);
	const catalog = prepaintDictionary(normalized) ?? hydratedPopupCache.get(normalized);
	if (!catalog) throw new Error(`Locale ${normalized} must be loaded before use`);
	return catalog;
}

export function clearPopupLocaleCatalogCache(): void {
	clearLocaleSectionStore(popupStore);
	hydratedPopupCache.clear();
}

export { hydratePopup };
