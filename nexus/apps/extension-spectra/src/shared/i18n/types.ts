/**
 * SPECTRA Shared - I18N Type Definitions
 */

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
	// Side Panel
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
	// Media Controls
	btnPause: string;
	btnPip: string;
	btnHotkeyTarget: string;
	btnGotoTab: string;
	// Settings
	pauseRetentionLabel: string;
	pauseRetentionSub: string;
	pauseRetentionUnit: string;
	// Common Tooltips
	tipPinPanel: string;
	tipClose: string;
	tipAdvancedSettings: string;
	// Side Panel Buttons
	spResetFx: string;
	spSaveFx: string;
	spResetFxTip: string;
	spSaveFxTip: string;
	// Video Controls
	spFullscreen: string;
	spDim: string;
	spSeek: string;
	spSaturate: string;
	spGrayscale: string;
	spInvert: string;
	// Presets
	grpPresets: string;
	presetsHint: string;
	btnClearPresets: string;
	// Remote Control
	btnRemoteTooltip: string;
	remoteModalTitle: string;
	remoteSessionCode: string;
	remoteConnected: string;
	remoteWaiting: string;
	remoteHint: string;
	remoteDisconnect: string;
	remoteCopied: string;
	remoteOpenLinkTitle: string;
	remoteConnectedTooltip: string;
	// Registry Empty States
	registryEmptyRestricted: string;
	registryEmptySafe: string;
	// CORS Tips (Content Script)
	corsAddedSafe: (domain: string) => string;
	corsCorrectedSafe: (domain: string) => string;
}

export type I18NMap = Record<string, I18NDict>;
