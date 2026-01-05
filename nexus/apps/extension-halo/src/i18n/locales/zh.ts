// goal: 中文翻译聚合
// eff: 导入分块文件以保持文件体积小

import type { TranslationKeys } from '../types';
import { hydrateTranslations } from '../utils';
import { base } from './zh-modules/base';
import { TOOLS_ZH } from './_generated-tools-zh';
import { zh as darkMode } from '../../components/settings/internal/dark-mode/locales/zh';
import { zh as jwtLocales } from '../../tools/jwt-decoder/locales/zh';

export const zh: TranslationKeys = {
	...base,
	...hydrateTranslations(TOOLS_ZH),
	...darkMode,
	...jwtLocales,
} as unknown as TranslationKeys;
