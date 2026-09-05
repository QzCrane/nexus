// goal: load only Options locale sections and the shared action display names

import type { SupportedLanguage } from '@nexus/contracts';
import {
	getActionName as getActionLabel,
	loadActionsSection,
	storeActionsCatalog,
} from './actions-catalog';
import {
	clearLocaleSectionStore,
	createLocaleSectionStore,
	decodeLocaleSectionResponse,
	loadLocaleSection,
	normalizeLanguage,
	type EncodedLocaleSectionAsset,
} from './locale-sections';

const optionsStore = createLocaleSectionStore();

function fetchOptionsSection(language: SupportedLanguage): Promise<EncodedLocaleSectionAsset> {
	return fetch(chrome.runtime.getURL(`i18n/options/${language}.json.gz`))
		.then((response) => decodeLocaleSectionResponse(response, `Options locale ${language}`));
}

export function storeOptionsCatalog(language: string, encoded: Record<string, string>): void {
	optionsStore.cache.set(normalizeLanguage(language), encoded);
}

export function loadOptionsSection(
	language: string,
	fetchSection: (language: SupportedLanguage) => Promise<EncodedLocaleSectionAsset> = fetchOptionsSection,
): Promise<Record<string, string>> {
	return loadLocaleSection(language, optionsStore, fetchSection);
}

export async function loadOptionsLocaleCatalog(language: string): Promise<void> {
	const [options, actions] = await Promise.all([
		loadOptionsSection(language),
		loadActionsSection(language),
	]);
	storeOptionsCatalog(language, options);
	storeActionsCatalog(language, actions);
}

export function getOptionsDictionary(language: string): Record<string, string> {
	const catalog = optionsStore.cache.get(normalizeLanguage(language));
	if (!catalog) throw new Error(`Locale ${normalizeLanguage(language)} must be loaded before use`);
	return catalog;
}

export function clearOptionsLocaleCatalogCache(): void {
	clearLocaleSectionStore(optionsStore);
}

export { getActionLabel as getActionName, loadActionsSection, storeActionsCatalog };
