// goal: English translations aggregator
// eff: Imports partials to keep file size small

import type { TranslationKeys } from '../types';
import { base } from './en-modules/base';
import { settings } from './en-modules/settings';
import { modules } from './en-modules/modules';
import { panelsCore } from './en-modules/panels-core';
import { panelsDev } from './en-modules/panels-dev';
import { panelsExtra } from './en-modules/panels-extra';
import { panelsV6 } from './en-modules/panels-v6';

export const en: TranslationKeys = {
	...base,
	...settings,
	...modules,
	...panelsCore,
	...panelsDev,
	...panelsExtra,
	...panelsV6,
};
