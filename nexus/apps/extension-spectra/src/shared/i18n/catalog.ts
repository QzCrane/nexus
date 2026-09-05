// goal: stable semantic facade for locale generation and test contracts

import type { I18NDict } from '../../popup/types';
import {
	clearPopupLocaleCatalogCache,
} from './popup-catalog';
import {
	clearOptionsLocaleCatalogCache,
} from './options-catalog';
import { clearActionsLocaleCatalogCache } from './actions-catalog';

export type OptionsI18nDict = Record<string, string>;

export interface SpectraLocaleSchema {
	popup: I18NDict;
	options: OptionsI18nDict;
	actions: Record<string, string>;
}

export {
	decodeLocaleSection,
	normalizeLanguage,
	parseLocaleSection,
	requireEnglishSection,
	sourceLanguage,
	SUPPORTED_SPECTRA_LANGUAGES,
	type EncodedLocaleSectionAsset,
	type LocaleSectionFetcher,
} from './locale-sections';

export {
	getActionName,
	getOptionsDictionary,
} from './options-catalog';
export { getPopupDictionary, hydratePopup } from './popup-catalog';
export { loadActionsSection, storeActionsCatalog } from './actions-catalog';

export {
	loadPopupSection,
	loadPopupLocaleCatalog,
	storePopupCatalog,
} from './popup-catalog';
export {
	loadOptionsSection,
	loadOptionsLocaleCatalog,
	storeOptionsCatalog,
} from './options-catalog';

// Tests and a full page retry may start a fresh projection realm. Each surface
// clears only its accepted data; callers still own any in-flight request.
export function clearLocaleCatalogCache(): void {
	clearPopupLocaleCatalogCache();
	clearOptionsLocaleCatalogCache();
	clearActionsLocaleCatalogCache();
}
