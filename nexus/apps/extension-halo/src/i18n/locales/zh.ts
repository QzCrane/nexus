// goal: 中文翻译聚合
// eff: 导入分块文件以保持文件体积小

import type { TranslationKeys } from '../types';
import { base } from './zh-modules/base';
import { modules } from './zh-modules/modules';
import { TOOLS_ZH } from './_generated-tools-zh';
import { zh as darkMode } from '../../modules/dark-mode/locales/zh';
import { zh as jwtLocales } from '../../tools/jwt-decoder/locales/zh';

// Helper to flatten legacy modules
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

export const zh: TranslationKeys = {
	...base,
	...flattenModules(modules),
	...TOOLS_ZH,
	...darkMode,
	...jwtLocales,
};
