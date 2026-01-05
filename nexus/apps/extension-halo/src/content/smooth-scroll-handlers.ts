// goal: Event handlers for Smooth Scroll
// eff: Loosely coupled handlers using shared state

import { scheduleClearCache, findScrollTarget, canScroll, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { scrollTo } from '../tools/smooth-scroll/engine';
import { settings, state, lastScrollTime, acceleration, updateAcceleration } from './smooth-scroll-state';

// Touchpad detection
function isTouchpad(deltaY: number): boolean {
	// ... existing logic ...
	if (!deltaY) return false;
	const absDelta = Math.abs(deltaY);
	state.deltaBuffer.push(absDelta);
	if (state.deltaBuffer.length > 3) state.deltaBuffer.shift();

	const allDivisibleBy120 = state.deltaBuffer.every((d) => d % 120 === 0);
	const allDivisibleBy100 = state.deltaBuffer.every((d) => d % 100 === 0);
	return !allDivisibleBy120 && !allDivisibleBy100 && absDelta < 120;
}

export function onWheel(e: WheelEvent): void {
	if (!settings.enabled || !settings.mouseWheel) return;
	if (e.defaultPrevented || e.ctrlKey) return;

	if (isTouchpad(e.deltaY) && !settings.touchpad) return;

	const target = findScrollTarget(e.target as Element);
	if (!canScroll(target)) return;

	e.preventDefault();
	scheduleClearCache();

	const now = Date.now();
	let newAcc = acceleration;
	if (now - lastScrollTime < settings.accelerationDelta) {
		newAcc = Math.min(acceleration + 0.5, settings.accelerationMax);
	} else {
		newAcc = 1;
	}
	updateAcceleration(newAcc, now);

	let deltaY = e.deltaY;
	if (e.deltaMode === 1) deltaY *= 40;
	if (Math.abs(deltaY) > 1.2) {
		deltaY = (deltaY > 0 ? 1 : -1) * settings.stepSize * newAcc;
	}

	scrollTo(target, 0, deltaY);
}

export function onKeydown(e: KeyboardEvent): void {
	if (!settings.enabled || !settings.keyboard) return;

	// Conflict: If site already handled it (e.g. video control), do not scroll
	if (e.defaultPrevented) return;

	if (e.ctrlKey || e.altKey || e.metaKey) return;

	if (shouldIgnoreInput(document.activeElement)) return;

	const target = findScrollTarget(document.activeElement as Element);
	if (!canScroll(target)) return;

	const pageHeight = window.innerHeight * 0.9;
	let deltaY = 0;

	switch (e.key) {
		case 'ArrowDown': deltaY = settings.arrowKeyStep; break;
		case 'ArrowUp': deltaY = -settings.arrowKeyStep; break;
		case 'PageDown': deltaY = pageHeight; break;
		case 'PageUp': deltaY = -pageHeight; break;
		case ' ':
			// Space key: skip if page has video elements (let site control video)
			if (document.querySelector('video')) return;
			deltaY = pageHeight;
			break;
		default: return;
	}

	e.preventDefault();
	scrollTo(target, 0, deltaY);
}

export function onMouseDown(e: MouseEvent): void {
	if (!settings.enabled || !settings.middleClickAutoScroll) return;
	if (e.button !== 1) return;

	const target = findScrollTarget(e.target as Element);
	if (!canScroll(target)) return;

	e.preventDefault();
	state.isMiddleScrolling = true;
	state.middleScrollStartY = e.clientY;
	state.middleScrollTarget = target;
	document.body.style.cursor = 'ns-resize';
}

export function onMouseMove(e: MouseEvent): void {
	if (!state.isMiddleScrolling || !state.middleScrollTarget) return;
	const deltaY = (e.clientY - state.middleScrollStartY) * 2;
	state.middleScrollStartY = e.clientY;

	if (state.middleScrollTarget instanceof Window) {
		window.scrollBy(0, deltaY);
	} else {
		state.middleScrollTarget.scrollTop += deltaY;
	}
}

export function onMouseUp(e: MouseEvent): void {
	if (e.button === 1 && state.isMiddleScrolling) {
		state.isMiddleScrolling = false;
		state.middleScrollTarget = null;
		document.body.style.cursor = '';
	}
}
