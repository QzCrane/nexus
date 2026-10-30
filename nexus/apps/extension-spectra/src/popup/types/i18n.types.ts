// goal: defines the schema for internationalization dictionaries used across the popup and content script overlays

export interface I18NDict {
	settingsTitle: string;
	osdLabel: string;
	osdSub: string;
	vizLabel: string;
	vizSub: string;
	vizDesc: string;
	langLabel: string;
	noAudio: string;
	mediaInventoryPartial: string;
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
	grpInterface: string;
	grpGeneral: string;
	grpAdvanced: string;
	tabRestricted: string;
	tabSafe: string;
	registryHint: string;
	registryEmptyRestricted: string;
	registrySourceAuto: string;
	registrySourceUser: string;
	registryFilterAria: string;
	registryNewDomainAria: string;
	registryRouteAria: string;
	registryAddDomainTitle: string;
	registryInvalidDomain: string;
	themeLabel: string;
	themeSub: string;
	themeLight: string;
	themeDark: string;
	themeSystem: string;
	btnThemeTooltip: string;
	btnSettingsTooltip: string;
	btnHotkeysTooltip: string;
	btnShortcutsTooltip: string;
	effectsLabel: string;
	controlSyncing: string;
	controlSyncUnavailable: string;

	// note: side panel specific labels for advanced audio and video effects
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

	// note: media playback and focus management tooltips
	btnPause: string;
	btnMute: string;
	btnPip: string;
	btnHotkeyTarget: string;
	btnGotoTab: string;

	// note: application-wide settings (e.g. state retention)
	pauseRetentionLabel: string;
	pauseRetentionSub: string;
	pauseRetentionUnit: string;

	// note: reusable interface string tokens
	tipPinPanel: string;
	tipClose: string;
	tipDelete: string;
	tipAdvancedSettings: string;
	spResetFx: string;
	spSaveFx: string;
	spResetFxTip: string;
	spSaveFxTip: string;
	spFullscreen: string;
	spDim: string;
	spSeek: string;
	spAbClear: string;
	spSaturate: string;
	spGrayscale: string;
	spInvert: string;
	grpPresets: string;
	presetsHint: string;
	btnClearPresets: string;

	// note: enhanced preset management
	presetSearchPlaceholder: string;
	presetGlobalSection: string;
	presetSiteSection: string;
	presetDefaultBadge: string;
	presetCurrentBadge: string;
	presetApplyTooltip: string;
	presetNoTarget: string;
	presetPreviewTooltip: string;
	presetSetDefaultTooltip: string;
	presetRemoveDefaultTooltip: string;
	presetDeleteTooltip: string;
	presetClearTitle: string;
	presetClearBody: string;
	presetClearConfirm: string;
	presetPreviewVolume: string;
	presetPreviewEnabled: string;
	presetPreviewMuted: string;
	presetPreviewPreservePitch: string;
	presetStateOn: string;
	presetStateOff: string;
	presetAppliedToast: (name: string) => string;
	btnClose: string;
	btnSaveAsGlobal: string;
	// note: zero-interaction global preset save. The name is auto-generated
	// from this base label plus a compact timestamp; the user is never
	// prompted. The previous presetSaveGlobalPrompt was removed because it
	// pre-filled the current domain and read as "name this after the domain".
	presetDefaultName: string;
	// note: effect summary tokens shown under each preset entry. Bass/Mono
	// reuse the card labels; Comp/Pan/Default have their own short forms so
	// the summary stays compact and independent of the card label wording.
	presetEffectComp: string;
	presetEffectPan: string;
	presetEffectPanRight: string;
	presetEffectPanLeft: string;
	presetEffectDefault: string;
	// note: transient save-button feedback shown inline on the button after a
	// site-config or global-preset save attempt. Shared by both save buttons so
	// the feedback style is consistent across them.
	saveSuccess: string;
	saveFailed: string;

	// note: remote synchronization and mobile connection UI
	btnRemoteTooltip: string;
	remoteModalTitle: string;
	remoteSessionCode: string;
	remoteConnected: string;
	remoteWaiting: string;
	remoteHint: string;
	remoteDisconnect: string;
	remoteDisconnectFailed: string;
	remoteCopied: string;
	remoteOpenLinkTitle: string;
	remoteConnectedTooltip: string;

	// note: preset search aria-label for the static presets-group input.
	presetSearchAria: string;

}

export type I18NMap = Record<string, I18NDict>;
