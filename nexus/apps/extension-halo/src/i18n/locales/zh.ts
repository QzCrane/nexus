// goal: 中文翻译聚合
// eff: 导入分块文件以保持文件体积小

import type { TranslationKeys } from '../types';
import { base } from './zh-modules/base';
import { settings } from './zh-modules/settings';
import { modules } from './zh-modules/modules';
import { TOOLS_ZH } from './_generated-tools-zh';

export const zh: TranslationKeys = {
	...base,
	...settings,
	...modules,
	...TOOLS_ZH,
};
