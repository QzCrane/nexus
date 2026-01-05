// goal: Comprehensive types for Hover Zoom (PhotoShow replacement)
// eff: Covers all settings, states, and constants

export type TriggerKey = 'none' | 'shift' | 'ctrl' | 'alt';
export type TriggerAction = 'hold' | 'toggle';
export type ViewMode = 'auto' | 'fit' | 'lite' | 'mini' | 'panoramic';
export type PopupPosition = 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center';
export type BackgroundMode = 'dark' | 'light' | 'blur' | 'page' | 'system';
export type InfoDisplay = 'none' | 'top' | 'bottom';
export type AnimationSpeed = 'none' | 'fast' | 'normal' | 'slow';

export interface ExemptionRules {
	maxViewportCoverage: number; // 0-1, e.g., 0.25 (25%)
	maxWidthCoverage: number;    // 0-1
	maxHeightCoverage: number;   // 0-1
	smallInteractive: boolean;   // Buttons, inputs
	playingVideo: boolean;
}

export interface HotkeyAction {
	enabled: boolean;
	key: string;
}

export interface HoverZoomSettings {
	// General
	enabled: boolean;

	// Trigger
	triggerKey: TriggerKey;
	triggerAction: TriggerAction;
	triggerDelay: number; // ms
	autoCloseDelay: number; // ms, 0 for disable

	// View
	viewMode: ViewMode;
	position: PopupPosition;
	background: BackgroundMode;
	showImageInfo: InfoDisplay;
	imageInfoItems: {
		caption: boolean;
		dimensions: boolean;
		format: boolean;
		size: boolean;
	};

	// Exemptions
	exemptions: ExemptionRules;

	// Advanced
	antiHotlink: boolean;
	enableAnimations: boolean;
	downloadTemplate: string; // e.g., "PhotoShow/<H>/<o>"

	// Site Rules
	siteBlacklist: string[];
	siteWhitelist: string[];
	whiteListMode: boolean;
}

export const DEFAULT_SETTINGS: HoverZoomSettings = {
	enabled: true,
	triggerKey: 'none',
	triggerAction: 'hold',
	triggerDelay: 100,
	autoCloseDelay: 0,
	viewMode: 'auto',
	position: 'auto',
	background: 'dark',
	showImageInfo: 'bottom',
	imageInfoItems: {
		caption: true,
		dimensions: true,
		format: true,
		size: true
	},
	exemptions: {
		maxViewportCoverage: 0.5,  // Allow up to 50% of viewport
		maxWidthCoverage: 0.8,     // Allow up to 80% width
		maxHeightCoverage: 0.8,    // Allow up to 80% height
		smallInteractive: true,
		playingVideo: true
	},
	antiHotlink: true,
	enableAnimations: true,
	downloadTemplate: 'Halo-Hover/<H>/<o>',
	siteBlacklist: [],
	siteWhitelist: [],
	whiteListMode: false
};

export const STORAGE_KEY = 'halo_hover_zoom_settings';

// Anti-hotlink domains (Predefined list)
export const HOTLINK_DOMAINS = [
	'*.bilibili.com',
	'*.hdslb.com',
	'*.weibo.com',
	'*.sinaimg.cn',
	'*.zhimg.com',
	'*.zhihu.com',
	'*.douban.com',
	'*.doubanio.com',
	'*.pixiv.net',
	'*.pximg.net',
	'*.artstation.com'
];

// Content Script Messages
export type CSMessage =
	| { type: 'SETTINGS_UPDATE'; settings: HoverZoomSettings }
	| { type: 'DOWNLOAD_IMAGE'; url: string; filename?: string }
	| { type: 'COPY_IMAGE_URL'; url: string }
	| { type: 'OPEN_NEW_TAB'; url: string };
