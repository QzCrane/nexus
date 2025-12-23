/**
 * SPECTRA Popup - I18N 英语
 */

import type { I18NDict } from '../../types';

export const EN_US: I18NDict = {
  settingsTitle: 'Settings',
  osdLabel: 'OSD Popup',
  osdSub: 'Overlay when using shortcuts',
  vizLabel: 'Visualizer',
  vizSub: 'Show dynamic audio bars',
  vizDesc: 'Disabling this saves resources on restricted sites (e.g. Tiktok) by using Native Lite mode until volume > 100%.',
  langLabel: 'Language',
  noAudio: 'No Audio Signal',
  bgTitle: 'Background',
  paused: 'Audio Enhancement Paused',
  clickToResume: 'Click to Resume',
  comp: 'Compressor',
  bass: 'Bass',
  mono: 'Mono',
  eqTitle: '🎚️ 10-Band EQ',
  reset: 'Reset',
  save: 'Save',
  resetTooltip: 'Reset volume and EQ to default values',
  saveTooltip: 'Save current settings as default for this domain',
  captureListLabel: 'Force Capture Mode',
  captureListSub: 'One domain per line (e.g. tiktok.com)',
  grpInterface: 'Interface',
  grpGeneral: 'General',
  grpAdvanced: 'Site Registry',
  tabRestricted: '🔒 Need Capture',
  tabSafe: '✅ Safe Sites',
  filterPlaceholder: '🔍 Filter...',
  registryHint: 'Sites are auto-detected. Manually add if needed.',
  autoAddedToast: (domain: string) => `🔧 Auto-added ${domain} to capture list`,
  // 主题相关
  themeLabel: 'Theme',
  themeSub: 'Choose your preferred color scheme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  // 导航按钮 tooltip
  btnThemeTooltip: 'Toggle Theme',
  btnSettingsTooltip: 'Settings',
  btnShortcutsTooltip: 'Keyboard Shortcuts',
};
