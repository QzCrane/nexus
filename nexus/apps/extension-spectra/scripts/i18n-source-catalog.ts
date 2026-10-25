// goal: the single build-time owner of the three typed locale surfaces

import { HOTKEY_ACTIONS, type HotkeyAction } from '../../../packages/contracts/src/hotkeys.contracts';
import { DICT, DICT_EN, type OptionsI18nKey } from '../src/options/i18n-dict';
import { getActionName } from '../src/options/i18n-actions';
import { I18N } from '../src/popup/constants/i18n';
import type { I18NDict } from '../src/popup/types';
import { SUPPORTED_SPECTRA_LANGUAGES, sourceLanguage } from '../src/shared/i18n/locale-sections';

/**
 * Complete runtime catalogs. English is the baseline for every surface, so a
 * locale shard only contributes its own overrides; the key schema is fixed by
 * the English Options dictionary and the contract-owned action list.
 */
export interface SpectraLocaleCatalog {
	popup: I18NDict;
	options: Record<OptionsI18nKey, string>;
	actions: Record<HotkeyAction, string>;
}

export function createSourceLocaleCatalogs(): Record<string, SpectraLocaleCatalog> {
	const englishPopup = I18N['en-US'];
	if (!englishPopup) throw new Error('English popup catalog is missing');

	const catalogs: Record<string, SpectraLocaleCatalog> = {};
	for (const language of SUPPORTED_SPECTRA_LANGUAGES) {
		const source = sourceLanguage(language);
		const popup = { ...englishPopup, ...(I18N[source] ?? {}) } as I18NDict;
		const options = { ...DICT_EN, ...(DICT[source] ?? {}) };
		const actions = {} as Record<HotkeyAction, string>;
		for (const action of HOTKEY_ACTIONS) actions[action] = getActionName(action, source);
		catalogs[language] = { popup, options, actions };
	}
	return catalogs;
}
