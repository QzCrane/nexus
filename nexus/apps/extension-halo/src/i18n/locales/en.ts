// goal: English translations aggregator
// eff: Imports partials to keep file size small

import type { TranslationKeys } from '../types';
import { hydrateTranslations } from '../utils';
import { base } from './en-modules/base';
import { TOOLS_EN } from './_generated-tools-en';
import { en as darkMode } from '../../kernel/services/dark-mode/locales/en';

export const en: TranslationKeys = {
	...base,
	...hydrateTranslations(TOOLS_EN),
	...darkMode,
} as unknown as TranslationKeys;

