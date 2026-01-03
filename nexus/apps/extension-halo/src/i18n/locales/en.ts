// goal: English translations aggregator
// eff: Imports partials to keep file size small

import type { TranslationKeys } from '../types';
import { base } from './en-modules/base';
import { modules } from './en-modules/modules';
import { TOOLS_EN } from './_generated-tools-en';
import { en as darkMode } from '../../modules/dark-mode/locales/en';
import { en as jwtLocales } from '../../tools/jwt-decoder/locales/en';

// Helper to flatten legacy modules to prevent object/string key conflicts
const flattenModules = (m: any) => {
	const out: Record<string, string> = {};
	if (m.tools) {
		Object.keys(m.tools).forEach(key => {
			const item = m.tools[key];
			if (item.name) out[`tools.${key}.name`] = item.name;
			if (item.desc) out[`tools.${key}.desc`] = item.desc;
		});
	}
	return out;
};

export const en: TranslationKeys = {
	...base,
	...flattenModules(modules),
	...TOOLS_EN,
	...darkMode,
	...jwtLocales,
};

