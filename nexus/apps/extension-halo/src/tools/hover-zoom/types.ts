// goal: Comprehensive types for Hover Zoom (PhotoShow replacement)
// eff: Covers all settings, states, and constants

export type TriggerKey = 'none' | 'shift' | 'ctrl' | 'alt';
export type TriggerAction = 'hold' | 'toggle';
export type ViewMode = 'auto' | 'fit' | 'lite' | 'mini' | 'panoramic';
export type PopupPosition = 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center';
export type BackgroundMode = 'dark' | 'light' | 'blur' | 'page' | 'system';
export type InfoDisplay = 'none' | 'top' | 'bottom';
export type AnimationSpeed = 'none' | 'fast' | 'normal' | 'slow';

/**
 * Key combination for triggering resource preview.
 * Supports single modifiers and combinations.
 * 
 * Examples:
 * - { shift: false, ctrl: false, alt: false } = 'none' (no modifier needed)
 * - { shift: false, ctrl: false, alt: true } = 'alt'
 * - { shift: false, ctrl: true, alt: true } = 'alt+ctrl'
 */
export interface KeyCombo {
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
}

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

/**
 * Resource type trigger keys configuration.
 * Each resource type (image/video) can have a different key combination.
 * Supports seamless switching between resources via additional modifier.
 * 
 * Example configurations:
 * - imageKey: { alt: true }, videoKey: { alt: true, ctrl: true }
 *   -> Press Alt = show image, then add Ctrl (Alt+Ctrl) = switch to video
 * 
 * - imageKey: { shift: true }, videoKey: { ctrl: true }
 *   -> Press Shift = show image, Press Ctrl = show video
 * 
 * Rules:
 * 1. More specific combo (more modifiers) wins when multiple match
 * 2. Seamless switching: when image is showing with Alt, pressing Ctrl switches to video
 */
export interface ResourceKeys {
	imageKey: KeyCombo;  // Key combo to trigger image preview
	videoKey: KeyCombo;  // Key combo to trigger video preview
}

export interface HoverZoomSettings {
	// General
	enabled: boolean;

	// Trigger - legacy, kept for backward compatibility
	triggerKey: TriggerKey;
	triggerAction: TriggerAction;
	triggerDelay: number; // ms
	autoCloseDelay: number; // ms, 0 for disable

	// Resource type switching (new)
	resourceKeys: ResourceKeys;

	// View
	viewMode: ViewMode;
	position: PopupPosition;
	background: BackgroundMode;
	showImageInfo: InfoDisplay;
	showLoadingIndicator: boolean;  // Show loading spinner on trigger element
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
	// Default: Alt shows image, Alt+Ctrl shows video (seamless switching)
	resourceKeys: {
		imageKey: { shift: false, ctrl: false, alt: true },      // Alt = image
		videoKey: { shift: false, ctrl: true, alt: true }        // Alt+Ctrl = video
	},
	viewMode: 'auto',
	position: 'auto',
	background: 'dark',
	showImageInfo: 'bottom',
	showLoadingIndicator: true,
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
