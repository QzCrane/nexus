// goal: Per-document runtime state for Smooth Scroll
// inv: Persisted setting shape is owned by tools/smooth-scroll/types.ts

import type { ScrollSettings } from '../tools/smooth-scroll/types';
import { DEFAULT_SETTINGS, normalizeScrollSettings } from '../tools/smooth-scroll/types';
import {
	createWheelGestureState,
	resetWheelGestureState,
} from '../tools/smooth-scroll/wheel-input';
export type { ScrollSettings } from '../tools/smooth-scroll/types';

export let settings: ScrollSettings = { ...DEFAULT_SETTINGS };
export let lastScrollTime: number | null = null;
export let acceleration = 1;
export let accelerationTarget: Element | Window | null = null;
export let accelerationDirection = 0;

export const state = {
	isMiddleScrolling: false,
	middleScrollStartY: 0,
	middleScrollTarget: null as Element | Window | null,
	middleScrollPreviousCursor: '',
	wheelGesture: createWheelGestureState(),
};

export const updateStateSettings = (value: unknown): ScrollSettings => {
	settings = normalizeScrollSettings(value);
	return settings;
};
export const updateAcceleration = (
	acc: number,
	time: number,
	target: Element | Window,
	direction: number,
): void => {
	acceleration = acc;
	lastScrollTime = time;
	accelerationTarget = target;
	accelerationDirection = direction;
};

export const resetAcceleration = (): void => {
	lastScrollTime = null;
	acceleration = 1;
	accelerationTarget = null;
	accelerationDirection = 0;
};

export const resetWheelRuntimeState = (): void => {
	resetAcceleration();
	resetWheelGestureState(state.wheelGesture);
};

export const resetRuntimeState = (): void => {
	resetWheelRuntimeState();
	state.isMiddleScrolling = false;
	state.middleScrollStartY = 0;
	state.middleScrollTarget = null;
	state.middleScrollPreviousCursor = '';
};
