// goal: Shared state for Smooth Scroll
// eff: Central source of truth

import type { EasingType } from '../tools/smooth-scroll/types';

export interface ScrollSettings {
	enabled: boolean; stepSize: number; animationTime: number;
	accelerationMax: number; accelerationDelta: number; pulseScale: number;
	arrowKeyStep: number; mouseWheel: boolean; keyboard: boolean;
	touchpad: boolean; middleClickAutoScroll: boolean; easing: EasingType;
}

export const defaultSettings: ScrollSettings = {
	enabled: true, stepSize: 300, animationTime: 400,
	accelerationMax: 3, accelerationDelta: 50, pulseScale: 4,
	arrowKeyStep: 200, mouseWheel: true, keyboard: true,
	touchpad: true, middleClickAutoScroll: true, easing: 'spring',
};

// Runtime state (Direct export)
export let settings: ScrollSettings = { ...defaultSettings };
export let lastScrollTime = 0;
export let acceleration = 1;

export const state = {
	isMiddleScrolling: false,
	middleScrollStartY: 0,
	middleScrollTarget: null as Element | Window | null,
	deltaBuffer: [] as number[],
};

export const updateStateSettings = (v: ScrollSettings) => (settings = v);
export const updateAcceleration = (acc: number, time: number) => { acceleration = acc; lastScrollTime = time; };
