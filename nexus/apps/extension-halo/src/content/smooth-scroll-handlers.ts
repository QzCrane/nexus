// goal: Event handlers for Smooth Scroll
// eff: Loosely coupled handlers using shared state

import { scheduleClearCache, findScrollTargetChained, canScrollBy } from '../tools/smooth-scroll/utils';
import { scrollTo } from '../tools/smooth-scroll/engine';
import { settings, state, lastScrollTime, acceleration, updateAcceleration } from './smooth-scroll-state';

// Static Cache & Config
const NATIVE_TAGS = new Set(['CANVAS', 'EMBED', 'OBJECT', 'MAP']);
const hotTarget: { el: Element | Window, ts: number, targetRef: EventTarget | null } = { el: window, ts: 0, targetRef: null };

function isTouchpad(deltaY: number): boolean {
	if (!deltaY) return false;
	const absDelta = Math.abs(deltaY);
	state.deltaBuffer.push(absDelta);
	if (state.deltaBuffer.length > 3) state.deltaBuffer.shift();

	// rule: Touchpads produce precise small floats rarely divisible by integer steps
	const isMouseLike = absDelta >= 120 || state.deltaBuffer.every(d => d % 120 === 0 || d % 100 === 0);
	return !isMouseLike;
}

export function onWheel(e: WheelEvent): void {
	if (!settings.enabled || !settings.mouseWheel || e.ctrlKey) return;

	// rule: Guard Pass-through (Maps/Canvas/Embeds)
	const t = e.target as HTMLElement;
	if (NATIVE_TAGS.has(t.tagName) || t.getAttribute('role') === 'img' || t.classList.contains('gm-style')) return;

	const touchpad = isTouchpad(e.deltaY);
	if (touchpad && !settings.touchpad) return;

	let deltaY = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;

	// perf: Hot cache check (150ms TTL)
	let target: Element | Window;
	const now = Date.now();
	if (now - hotTarget.ts < 150 && hotTarget.targetRef === e.target) {
		target = hotTarget.el;
		hotTarget.ts = now;
	} else {
		target = findScrollTargetChained(e.target as Element, deltaY);
		hotTarget.el = target;
		hotTarget.ts = now;
		hotTarget.targetRef = e.target;
	}

	if (!canScrollBy(target, deltaY)) {
		// rule: if we found a specific trapped target (Fixed/Contain) that can't scroll, kill the event to prevent native bleeding
		if (target !== window) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		}
		return;
	}

	e.preventDefault();
	scheduleClearCache();

	if (touchpad) {
		target instanceof Window ? window.scrollBy(0, deltaY) : target.scrollTop += deltaY;
		return;
	}

	// Queue-based Animation with Acceleration
	const scrollNow = Date.now();
	const newAcc = scrollNow - lastScrollTime < settings.accelerationDelta
		? Math.min(acceleration + 0.5, settings.accelerationMax)
		: 1;

	updateAcceleration(newAcc, scrollNow);

	if (Math.abs(deltaY) > 1.2) {
		deltaY = Math.sign(deltaY) * settings.stepSize * newAcc;
	}

	scrollTo(target, 0, deltaY);
}

export { onKeydown } from './smooth-scroll-keyboard';

export function onMouseDown(e: MouseEvent): void {
	if (!settings.enabled || !settings.middleClickAutoScroll || e.button !== 1) return;

	const target = findScrollTargetChained(e.target as Element, 1);
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

	state.middleScrollTarget instanceof Window
		? window.scrollBy(0, deltaY)
		: state.middleScrollTarget.scrollTop += deltaY;
}

export function onMouseUp(e: MouseEvent): void {
	if (e.button === 1 && state.isMiddleScrolling) {
		state.isMiddleScrolling = false;
		state.middleScrollTarget = null;
		document.body.style.cursor = '';
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);
	}
}
