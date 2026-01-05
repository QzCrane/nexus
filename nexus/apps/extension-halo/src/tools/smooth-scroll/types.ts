// goal: Smooth Scroll tool type definitions - full feature parity

export interface ScrollSettings {
	enabled: boolean;
	// Core parameters (matching SmoothScroll extension)
	stepSize: number; // px, default 100
	animationTime: number; // ms, default 400
	accelerationMax: number; // multiplier, default 3
	accelerationDelta: number; // ms between events, default 50
	pulseScale: number; // tail ratio, default 4
	arrowKeyStep: number; // px, default 50
	// Input sources
	mouseWheel: boolean;
	keyboard: boolean;
	touchpad: boolean;
	// Features
	middleClickAutoScroll: boolean;
	fixedBackground: boolean;
	// Easing
	easing: 'linear' | 'ease' | 'ease-out' | 'spring';
}

export const DEFAULT_SETTINGS: ScrollSettings = {
	enabled: true,
	stepSize: 300,
	animationTime: 400,
	accelerationMax: 3,
	accelerationDelta: 50,
	pulseScale: 1,
	arrowKeyStep: 200,
	mouseWheel: true,
	keyboard: true,
	touchpad: true,
	middleClickAutoScroll: true,
	fixedBackground: false,
	easing: 'spring',
};

export const STORAGE_KEY = 'HALO_SMOOTH_SCROLL_SETTINGS';

export const EASING_OPTIONS = [
	{ value: 'linear', i18nKey: 'linear' },
	{ value: 'ease', i18nKey: 'ease' },
	{ value: 'ease-out', i18nKey: 'easeOut' },
	{ value: 'spring', i18nKey: 'spring' },
] as const;

// Preset profiles
export const PROFILES = {
	default: { ...DEFAULT_SETTINGS },
	iPhone: { ...DEFAULT_SETTINGS, stepSize: 80, animationTime: 350, pulseScale: 3 },
	opera: { ...DEFAULT_SETTINGS, stepSize: 120, animationTime: 300, accelerationMax: 4 },
	ie: { ...DEFAULT_SETTINGS, stepSize: 60, animationTime: 500, easing: 'ease' as const },
} as const;

// Custom profile storage key
export const CUSTOM_PROFILE_KEY = 'HALO_SMOOTH_SCROLL_CUSTOM';
