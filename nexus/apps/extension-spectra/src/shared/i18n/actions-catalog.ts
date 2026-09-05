// goal: one coalesced owner for localized action labels shared by Popup and Options

import type { SupportedLanguage } from '@nexus/contracts';
import {
	cacheLocaleSection,
	clearLocaleSectionStore,
	createLocaleSectionStore,
	decodeLocaleSectionResponse,
	loadLocaleSection,
	normalizeLanguage,
	type EncodedLocaleSectionAsset,
	type LocaleSectionFetcher,
} from './locale-sections';

const actionsStore = createLocaleSectionStore();

function fetchActionsSection(language: SupportedLanguage): Promise<EncodedLocaleSectionAsset> {
	return fetch(chrome.runtime.getURL(`i18n/actions/${language}.json.gz`))
		.then((response) => decodeLocaleSectionResponse(response, `action locale ${language}`));
}

export function storeActionsCatalog(language: string, encoded: Record<string, string>): void {
	cacheLocaleSection(actionsStore, language, encoded);
}

export function loadActionsSection(
	language: string,
	fetchSection: LocaleSectionFetcher = fetchActionsSection,
): Promise<Record<string, string>> {
	return loadLocaleSection(language, actionsStore, fetchSection);
}

export function getActionName(action: string, language: string): string {
	return actionsStore.cache.get(normalizeLanguage(language))?.[action]
		?? action.replace(/_/g, ' ');
}

export function clearActionsLocaleCatalogCache(): void {
	clearLocaleSectionStore(actionsStore);
}
