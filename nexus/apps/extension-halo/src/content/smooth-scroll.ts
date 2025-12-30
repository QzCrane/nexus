// goal: Smooth Scroll content script - uses queue-based engine
// inv: No jumping, silky smooth scrolling

import { scrollTo, configure, clearQueue } from '../tools/smooth-scroll/engine';
import type { EasingType } from '../tools/smooth-scroll/engine';
import { findScrollTarget, canScroll, scheduleClearCache } from '../tools/smooth-scroll/utils';

const LOG_TAG = '[HALO:Scroll]';

// ===== SETTINGS =====
interface ScrollSettings {
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

let settings: ScrollSettings = {
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

// ===== STATE =====
let lastScrollTime = 0;
let acceleration = 1;

// Middle click state
let isMiddleScrolling = false;
let middleScrollStartY = 0;
let middleScrollTarget: Element | Window | null = null;

// Touchpad detection buffer
const deltaBuffer: number[] = [];

// ===== TOUCHPAD DETECTION =====
function isTouchpad(deltaY: number): boolean {
	if (!deltaY) return false;

	const absDelta = Math.abs(deltaY);
	deltaBuffer.push(absDelta);
	if (deltaBuffer.length > 3) deltaBuffer.shift();

	// Mouse wheel typically sends multiples of 120
	const allDivisibleBy120 = deltaBuffer.every((d) => d % 120 === 0);
	const allDivisibleBy100 = deltaBuffer.every((d) => d % 100 === 0);

	return !allDivisibleBy120 && !allDivisibleBy100 && absDelta < 120;
}

// ===== WHEEL HANDLER =====
function onWheel(e: WheelEvent): void {
	if (!settings.enabled || !settings.mouseWheel) return;
	if (e.defaultPrevented || e.ctrlKey) return;

	// Touchpad detection
	const touchpad = isTouchpad(e.deltaY);
	if (touchpad && !settings.touchpad) return;

	// Find scrollable target
	const target = findScrollTarget(e.target as Element);
	if (!canScroll(target)) return;

	e.preventDefault();
	scheduleClearCache();

	// Acceleration
	const now = Date.now();
	if (now - lastScrollTime < settings.accelerationDelta) {
		acceleration = Math.min(acceleration + 0.5, settings.accelerationMax);
	} else {
		acceleration = 1;
	}
	lastScrollTime = now;

	// Calculate delta
	let deltaY = e.deltaY;

	// Normalize line-based scrolling
	if (e.deltaMode === 1) deltaY *= 40;

	// Apply step size (wheel delta is ~120)
	if (Math.abs(deltaY) > 1.2) {
		deltaY = (deltaY > 0 ? 1 : -1) * settings.stepSize * acceleration;
	}

	scrollTo(target, 0, deltaY);
}

// ===== KEYBOARD HANDLER =====
function onKeydown(e: KeyboardEvent): void {
	if (!settings.enabled || !settings.keyboard) return;

	const el = e.target as HTMLElement;
	if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
	if (e.ctrlKey || e.altKey || e.metaKey) return;

	const target = findScrollTarget(document.activeElement as Element);
	if (!canScroll(target)) return;

	const pageHeight = window.innerHeight * 0.9;
	let deltaY = 0;

	switch (e.key) {
		case 'ArrowDown':
			deltaY = settings.arrowKeyStep;
			break;
		case 'ArrowUp':
			deltaY = -settings.arrowKeyStep;
			break;
		case 'PageDown':
		case ' ':
			deltaY = pageHeight;
			break;
		case 'PageUp':
			deltaY = -pageHeight;
			break;
		default:
			return;
	}

	e.preventDefault();
	scrollTo(target, 0, deltaY);
}

// ===== MIDDLE CLICK =====
function onMouseDown(e: MouseEvent): void {
	if (!settings.enabled || !settings.middleClickAutoScroll) return;
	if (e.button !== 1) return;

	const target = findScrollTarget(e.target as Element);
	if (!canScroll(target)) return;

	e.preventDefault();
	isMiddleScrolling = true;
	middleScrollStartY = e.clientY;
	middleScrollTarget = target;
	document.body.style.cursor = 'ns-resize';
}

function onMouseMove(e: MouseEvent): void {
	if (!isMiddleScrolling || !middleScrollTarget) return;

	const deltaY = (e.clientY - middleScrollStartY) * 2;
	middleScrollStartY = e.clientY;

	if (middleScrollTarget instanceof Window) {
		window.scrollBy(0, deltaY);
	} else {
		middleScrollTarget.scrollTop += deltaY;
	}
}

function onMouseUp(e: MouseEvent): void {
	if (e.button === 1 && isMiddleScrolling) {
		isMiddleScrolling = false;
		middleScrollTarget = null;
		document.body.style.cursor = '';
	}
}

// ===== API =====
export function updateSettings(newSettings: ScrollSettings): void {
	const wasEnabled = settings.enabled;
	settings = newSettings;

	configure(settings.animationTime, settings.easing);

	if (newSettings.enabled && !wasEnabled) {
		attachListeners();
	} else if (!newSettings.enabled && wasEnabled) {
		detachListeners();
		clearQueue();
	}

	console.log(LOG_TAG, 'Updated:', newSettings.enabled ? 'ON' : 'OFF');
}

export function attachListeners(): void {
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMouseDown);
	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', onMouseUp);
}

export function detachListeners(): void {
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMouseDown);
	window.removeEventListener('mousemove', onMouseMove);
	window.removeEventListener('mouseup', onMouseUp);
}

export async function init(): Promise<void> {
	try {
		const result = await chrome.storage.sync.get(['HALO_SMOOTH_SCROLL_SETTINGS']);
		if (result.HALO_SMOOTH_SCROLL_SETTINGS) {
			settings = result.HALO_SMOOTH_SCROLL_SETTINGS;
		}
	} catch {
		console.log(LOG_TAG, 'Using defaults');
	}

	configure(settings.animationTime, settings.easing);

	if (settings.enabled) {
		attachListeners();
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) {
			updateSettings(changes.HALO_SMOOTH_SCROLL_SETTINGS.newValue);
		}
	});

	console.log(LOG_TAG, 'Init');
}
