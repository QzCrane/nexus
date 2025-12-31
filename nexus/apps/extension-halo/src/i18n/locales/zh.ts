// goal: 中文翻译聚合
// eff: 导入分块文件以保持文件体积小

import type { TranslationKeys } from '../types';
import { base } from './zh-modules/base';
import { settings } from './zh-modules/settings';
import { modules } from './zh-modules/modules';
import { panelsCore } from './zh-modules/panels-core';
import { panelsDev } from './zh-modules/panels-dev';
import { panelsExtra } from './zh-modules/panels-extra';
import { panelsV6 } from './zh-modules/panels-v6';

export const zh: TranslationKeys = {
	...base,
	...settings,
	...modules,
	...panelsCore,
	...panelsDev,
	...panelsExtra,
	...panelsV6,
};
