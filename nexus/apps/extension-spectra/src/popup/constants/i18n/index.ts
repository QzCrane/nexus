/**
 * SPECTRA Popup - I18N 统一导出
 */

import type { I18NMap } from '../../types';
import { EN_US } from './en';
import { ZH_CN, JA_JP, KO_KR } from './asia';
import { ES_ES, FR_FR, DE_DE, RU_RU } from './europe';

/** 完整的国际化字典映射 */
export const I18N: I18NMap = {
  'en-US': EN_US,
  'zh-CN': ZH_CN,
  'ja-JP': JA_JP,
  'ko-KR': KO_KR,
  'es-ES': ES_ES,
  'fr-FR': FR_FR,
  'de-DE': DE_DE,
  'ru-RU': RU_RU,
};

/** 默认语言 */
export const DEFAULT_LANG = 'en-US';

/** 支持的语言列表 */
export const SUPPORTED_LANGS = Object.keys(I18N) as Array<keyof typeof I18N>;

/**
 * 获取指定语言的字典，fallback 到英语
 */
export function getDict(lang: string) {
  return I18N[lang] || I18N[DEFAULT_LANG];
}

// 重导出各语言字典
export { EN_US } from './en';
export { ZH_CN, JA_JP, KO_KR } from './asia';
export { ES_ES, FR_FR, DE_DE, RU_RU } from './europe';
