/**
 * SPECTRA Popup - 常量统一导出
 * 
 * 所有 UI 常量的唯一入口
 */

// 颜色常量
export { COLORS, EQ_GRADIENT } from './colors';
export type { ColorKey } from './colors';

// 音频 UI 参数
export { AUDIO_UI, DEFAULT_EQ_VALUES } from './audio';

// 时间与 UI 尺寸
export { TIMING, UI_SIZES, VIZ_PARAMS } from './timing';

// 国际化
export { I18N, DEFAULT_LANG, SUPPORTED_LANGS, getDict } from './i18n';

// 受限 URL 前缀 (复用自 background)
export const RESTRICTED_URL_PREFIXES = [
  'chrome:',
  'edge:',
  'about:',
  'chrome-extension:',
] as const;
