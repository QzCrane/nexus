// goal: Smooth Scroll tool type definitions - full feature parity

export interface ScrollSettings {
	enabled: boolean;
	// Core parameters
	stepSize: number; // px, default 300
	animationTime: number; // ms, default 400
	accelerationMax: number; // response-gain multiplier, never distance, default 3
	accelerationDelta: number; // ms between events, default 50
	pulseScale: number; // bounded coarse-response intensity, default 4
	arrowKeyStep: number; // px, default 300 (matches stepSize for parity with mouse wheel)
	// Input sources
	mouseWheel: boolean;
	keyboard: boolean;
	touchpad: boolean;
	// Features
	middleClickAutoScroll: boolean;
	respectReducedMotion: boolean;
	// Easing
	easing: EasingType;
}

export type EasingType = 'linear' | 'ease' | 'ease-out' | 'spring';
export type ScrollInputMode = 'fine' | 'coarse';

export const DEFAULT_SETTINGS: ScrollSettings = {
	enabled: true,
	stepSize: 300,
	animationTime: 400,
	accelerationMax: 3,
	accelerationDelta: 50,
	pulseScale: 4,
	arrowKeyStep: 300,
	mouseWheel: true,
	keyboard: true,
	touchpad: true,
	middleClickAutoScroll: true,
	respectReducedMotion: false,
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

const EASING_VALUES = new Set<EasingType>(['linear', 'ease', 'ease-out', 'spring']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanValue(
	value: unknown,
	fallback: boolean,
): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function numberValue(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}

export function normalizeScrollSettings(value: unknown): ScrollSettings {
	const input = isRecord(value) ? value : {};
	const easing = typeof input.easing === 'string' && EASING_VALUES.has(input.easing as EasingType)
		? input.easing as EasingType
		: DEFAULT_SETTINGS.easing;

	return {
		enabled: booleanValue(input.enabled, DEFAULT_SETTINGS.enabled),
		stepSize: numberValue(input.stepSize, DEFAULT_SETTINGS.stepSize, 10, 500),
		animationTime: numberValue(input.animationTime, DEFAULT_SETTINGS.animationTime, 50, 2000),
		accelerationMax: numberValue(input.accelerationMax, DEFAULT_SETTINGS.accelerationMax, 1, 10),
		accelerationDelta: numberValue(input.accelerationDelta, DEFAULT_SETTINGS.accelerationDelta, 10, 300),
		pulseScale: numberValue(input.pulseScale, DEFAULT_SETTINGS.pulseScale, 1, 10),
		arrowKeyStep: numberValue(input.arrowKeyStep, DEFAULT_SETTINGS.arrowKeyStep, 10, 500),
		mouseWheel: booleanValue(input.mouseWheel, DEFAULT_SETTINGS.mouseWheel),
		keyboard: booleanValue(input.keyboard, DEFAULT_SETTINGS.keyboard),
		touchpad: booleanValue(input.touchpad, DEFAULT_SETTINGS.touchpad),
		middleClickAutoScroll: booleanValue(
			input.middleClickAutoScroll,
			DEFAULT_SETTINGS.middleClickAutoScroll,
		),
		respectReducedMotion: booleanValue(
			input.respectReducedMotion,
			DEFAULT_SETTINGS.respectReducedMotion,
		),
		easing,
	};
}
