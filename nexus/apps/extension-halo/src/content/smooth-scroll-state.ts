// goal: Shared state for Smooth Scroll content script
// eff: Central source of truth for settings and runtime state

import type { EasingType } from '../tools/smooth-scroll/types';

export interface ScrollSettings {
	enabled: boolean;
	stepSize: number;
	animationTime: number;
	accelerationMax: number;
	accelerationDelta: number;
	pulseScale: number;
	arrowKeyStep: number;
	mouseWheel: boolean;
	keyboard: boolean;
	touchpad: boolean;
	middleClickAutoScroll: boolean;
	easing: EasingType;
}

export const defaultSettings: ScrollSettings = {
	enabled: true,
	stepSize: 300,
	animationTime: 400,
	accelerationMax: 3,
	accelerationDelta: 50,
	pulseScale: 4,
	arrowKeyStep: 200,
	mouseWheel: true,
	keyboard: true,
	touchpad: true,
	middleClickAutoScroll: true,
	easing: 'spring',
};

// Runtime state
export let settings: ScrollSettings = { ...defaultSettings };
export let lastScrollTime = 0;
export let acceleration = 1;

export const state = {
	isMiddleScrolling: false,
	middleScrollStartY: 0,
	middleScrollTarget: null as Element | Window | null,
	deltaBuffer: [] as number[],
};

export function updateStateSettings(newSettings: ScrollSettings) {
	settings = newSettings;
}

export function updateAcceleration(acc: number, time: number) {
	acceleration = acc;
	lastScrollTime = time;
}
