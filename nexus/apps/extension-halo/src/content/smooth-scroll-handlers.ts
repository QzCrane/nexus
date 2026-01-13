// goal: Event handlers for Smooth Scroll
// eff: Loosely coupled handlers using shared state

import { scheduleClearCache, findScrollTargetChained, canScrollBy } from '../tools/smooth-scroll/utils';
import { scrollTo } from '../tools/smooth-scroll/engine';
import { settings, state, lastScrollTime, acceleration, updateAcceleration } from './smooth-scroll-state';

// Touchpad detection & Hot Cache
let hotTarget: { el: Element | Window, ts: number, targetRef: EventTarget | null } | null = null;

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

	// rule: "Smart Capture" - We intercept early to override Douyin, BUT we must be careful.

	// Guard: Pass-through for Maps/Canvas/Embeds (Respect Native)
	// If the user interacts with these, they likely want the native behavior (Zoom, Pan, Interaction)
	const t = e.target as HTMLElement;
	if (t.tagName === 'CANVAS' || t.tagName === 'EMBED' || t.tagName === 'OBJECT' || t.tagName === 'MAP' ||
		t.getAttribute('role') === 'img' || t.classList.contains('gm-style')) {
		return;
	}

	if (e.ctrlKey) return;

	const touchpad = isTouchpad(e.deltaY);
	if (touchpad && !settings.touchpad) return;

	let deltaY = e.deltaY;
	if (e.deltaMode === 1) deltaY *= 40;

	// perf: Hot cache check
	// If frequent events on same target, reuse the scroll container
	let target: Element | Window;
	const now = Date.now();

	if (hotTarget &&
		now - hotTarget.ts < 150 &&
		hotTarget.targetRef === e.target) {
		// Cache Hit!
		target = hotTarget.el;
		hotTarget.ts = now;
	} else {
		// Cache Miss - Traverse DOM
		target = findScrollTargetChained(e.target as Element, deltaY);
		hotTarget = { el: target, ts: now, targetRef: e.target };
	}

	// If target cannot scroll in this direction (and chaining didn't find a better one), bubble up
	if (!canScrollBy(target, deltaY)) return;

	e.preventDefault();
	scheduleClearCache();

	// rule: touchpad uses direct scroll for responsive "native" feel
	if (touchpad) {
		if (target instanceof Window) {
			window.scrollBy(0, deltaY);
		} else {
			target.scrollTop += deltaY;
		}
		return;
	}

	// Mouse wheel: use animation queue with acceleration
	const scrollNow = Date.now();
	let newAcc = acceleration;
	if (scrollNow - lastScrollTime < settings.accelerationDelta) {
		newAcc = Math.min(acceleration + 0.5, settings.accelerationMax);
	} else {
		newAcc = 1;
	}
	updateAcceleration(newAcc, scrollNow);

	if (Math.abs(deltaY) > 1.2) {
		deltaY = (deltaY > 0 ? 1 : -1) * settings.stepSize * newAcc;
	}

	scrollTo(target, 0, deltaY);
}

export { onKeydown } from './smooth-scroll-keyboard';

export function onMouseDown(e: MouseEvent): void {
	if (!settings.enabled || !settings.middleClickAutoScroll) return;
	if (e.button !== 1) return;

	// Middle click also needs chaining support logic (simplified for now to just check scrollability)
	const target = findScrollTargetChained(e.target as Element, 1); // Assume positive direction check
	if (!canScrollBy(target, 1)) return;

	e.preventDefault();
	state.isMiddleScrolling = true;
	state.middleScrollStartY = e.clientY;
	state.middleScrollTarget = target;
	document.body.style.cursor = 'ns-resize';

	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', onMouseUp);
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
		stopMiddleScroll();
	}
}

function stopMiddleScroll() {
	state.isMiddleScrolling = false;
	state.middleScrollTarget = null;
	document.body.style.cursor = '';
	window.removeEventListener('mousemove', onMouseMove);
	window.removeEventListener('mouseup', onMouseUp);
}
