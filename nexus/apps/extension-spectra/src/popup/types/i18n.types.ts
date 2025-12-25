/**
 * SPECTRA Popup - 国际化类型定义
 */

/** 国际化字典项 */
export interface I18NDict {
	settingsTitle: string;
	osdLabel: string;
	osdSub: string;
	vizLabel: string;
	vizSub: string;
	vizDesc: string;
	langLabel: string;
	noAudio: string;
	bgTitle: string;
	paused: string;
	clickToResume: string;
	comp: string;
	bass: string;
	mono: string;
	eqTitle: string;
	reset: string;
	save: string;
	resetTooltip: string;
	saveTooltip: string;
	captureListLabel: string;
	captureListSub: string;
	grpInterface: string;
	grpGeneral: string;
	grpAdvanced: string;
	tabRestricted: string;
	tabSafe: string;
	filterPlaceholder: string;
	registryHint: string;
	autoAddedToast: (domain: string) => string;
	themeLabel: string;
	themeSub: string;
	themeLight: string;
	themeDark: string;
	themeSystem: string;
	btnThemeTooltip: string;
	btnSettingsTooltip: string;
	btnShortcutsTooltip: string;
	// 侧边面板
	spAudio: string;
	spPan: string;
	spDelay: string;
	spSpeed: string;
	spValue: string;
	spVideo: string;
	spRotate: string;
	spMirror: string;
	spCrop: string;
	spScreenshot: string;
	spBrightness: string;
	spContrast: string;
	spHotkey: string;
	spHotkeyThis: string;
	spHotkeyPinned: string;
	spHotkeyLast: string;
	// 媒体控制
	btnPause: string;
	btnPip: string;
	btnHotkeyTarget: string;
	btnGotoTab: string;
	// 设置项
	pauseRetentionLabel: string;
	pauseRetentionSub: string;
	pauseRetentionUnit: string;
	// 通用悬停提示
	tipPinPanel: string;
	tipClose: string;
	tipAdvancedSettings: string;
	// 侧边面板按钮
	spResetFx: string;
	spSaveFx: string;
	spResetFxTip: string;
	spSaveFxTip: string;
	// 新增视频控件
	spFullscreen: string;
	spDim: string;
	spSeek: string;
	spSaturate: string;
	spGrayscale: string;
	spInvert: string;
	// 预设管理
	grpPresets: string;
	presetsHint: string;
	btnClearPresets: string;
}

/** 所有语言的 I18N 映射 */
export type I18NMap = Record<string, I18NDict>;
