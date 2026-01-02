// goal: English translations aggregator
// eff: Imports partials to keep file size small

import type { TranslationKeys } from '../types';
import { base } from './en-modules/base';
import { modules } from './en-modules/modules';
import { TOOLS_EN } from './_generated-tools-en';

export const en: TranslationKeys = {
	...base,
	...modules,
	...TOOLS_EN,
};

