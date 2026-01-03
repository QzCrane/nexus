// goal: English translations aggregator
// eff: Imports partials to keep file size small

import type { TranslationKeys } from '../types';
import { hydrateTranslations } from '../utils';
import { base } from './en-modules/base';
import { TOOLS_EN } from './_generated-tools-en';
import { en as darkMode } from '../../modules/dark-mode/locales/en';
import { en as jwtLocales } from '../../tools/jwt-decoder/locales/en';

export const en: TranslationKeys = {
	...base,
	...hydrateTranslations(TOOLS_EN),
	...darkMode,
	...jwtLocales,
} as unknown as TranslationKeys;

