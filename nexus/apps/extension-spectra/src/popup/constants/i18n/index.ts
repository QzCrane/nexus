/**
 * SPECTRA Popup - I18N 统一导出
 */

import type { I18NMap, I18NDict } from '../../types';
import { EN_US } from './en';
import { ZH_CN } from './zh-CN';
import { JA_JP } from './ja-JP';
import { KO_KR } from './ko-KR';
import { ES_ES } from './es-ES';
import { FR_FR } from './fr-FR';
import { DE_DE } from './de-DE';
import { RU_RU } from './ru-RU';

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

/** 获取指定语言的字典，fallback 到英语 */
export function getDict(lang: string): I18NDict {
  return I18N[lang] || I18N[DEFAULT_LANG]!;
}

// 重导出各语言字典
export { EN_US } from './en';
export { ZH_CN } from './zh-CN';
export { JA_JP } from './ja-JP';
export { KO_KR } from './ko-KR';
export { ES_ES } from './es-ES';
export { FR_FR } from './fr-FR';
export { DE_DE } from './de-DE';
export { RU_RU } from './ru-RU';
