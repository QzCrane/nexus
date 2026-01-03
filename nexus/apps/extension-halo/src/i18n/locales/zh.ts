// goal: 中文翻译聚合
// eff: 导入分块文件以保持文件体积小

import type { TranslationKeys } from '../types';
import { base } from './zh-modules/base';
import { modules } from './zh-modules/modules';
import { TOOLS_ZH } from './_generated-tools-zh';
import { zh as darkMode } from '../../modules/dark-mode/locales/zh';
import { zh as jwtLocales } from '../../tools/jwt-decoder/locales/zh';

export const zh: TranslationKeys = {
	...base,
	...modules,
	...TOOLS_ZH,
	...darkMode,
	...jwtLocales,
};
