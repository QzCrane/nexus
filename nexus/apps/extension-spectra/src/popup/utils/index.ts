/**
 * SPECTRA Popup - Utils 导出
 */

export {
  messenger,
  $,
  $required,
  $$,
  getSettingsUIElements,
  getDomain,
  isRestrictedUrl,
  sendToTab,
  sendToBackground,
  ensureInjected,
} from './dom';

// 主题管理工具
export {
  applyTheme,
  getEffectiveTheme,
  getNextThemeMode,
  THEME_ICONS
} from './theme';
