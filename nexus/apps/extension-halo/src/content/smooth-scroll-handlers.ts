// goal: Input admission for Smooth Scroll
// inv: Site-owned and native surfaces receive first refusal

import { canScrollBy, canonicalizeScrollTarget, prefersReducedMotion, resolveDirectScrollRoute, resolveScrollRoute } from '../tools/smooth-scroll/utils';
import {
	clearQueue,
	queueOwnedVerticalScroll,
	scrollTo,
} from '../tools/smooth-scroll/engine';
import {
	classifyWheelGesture,
	normalizeWheelDeltaY,
	wheelEventTarget,
	wheelEventTimestamp,
	wheelNeedsComposedPath,
} from '../tools/smooth-scroll/wheel-input';
import {
	acceleration,
	accelerationDirection,
	accelerationTarget,
	lastScrollTime,
	resetAcceleration,
	resetWheelRuntimeState,
	settings,
	state,
	updateAcceleration,
} from './smooth-scroll-state';
import {
	onArrowKeydownCapture,
	onKeyboardFocusIn,
	onKeyboardPointerDown,
	onKeydown,
	resetKeyboardRuntime,
} from './smooth-scroll-keyboard';
export {
	onArrowKeydownCapture,
	onKeyboardFocusIn,
	onKeyboardPointerDown,
	onKeydown,
};

function yieldWheelToNative(): void {
	clearQueue();
	resetWheelRuntimeState();
}

export function onWheel(e: WheelEvent): void {
	if (!e.isTrusted) return;
	if (state.isMiddleScrolling) cancelMiddleScroll();
	if (!settings.enabled) {
		yieldWheelToNative();
		return;
	}
	if (
		e.defaultPrevented ||
		!e.cancelable ||
		e.ctrlKey ||
		!e.deltaY
	) {
		yieldWheelToNative();
		return;
	}

	let eventTarget = wheelEventTarget(e);
	let composedPath: readonly EventTarget[] | undefined;
	if (!eventTarget || wheelNeedsComposedPath(eventTarget)) {
		composedPath = e.composedPath();
	}
	if (!eventTarget && composedPath) {
		for (const target of composedPath) {
			if (target instanceof Element) {
				eventTarget = target;
				break;
			}
		}
	}
	if (
		!eventTarget ||
		(settings.respectReducedMotion && prefersReducedMotion())
	) {
		yieldWheelToNative();
		return;
	}

	const timestamp = wheelEventTimestamp(e);
	let deltaY = normalizeWheelDeltaY(e);
	const gesture = classifyWheelGesture(e, timestamp, state.wheelGesture);
	if (gesture === 'horizontal') {
		yieldWheelToNative();
		return;
	}
	const inputMode = gesture;
	if (
		(inputMode === 'fine' && !settings.touchpad) ||
		(inputMode === 'coarse' && !settings.mouseWheel)
	) {
		yieldWheelToNative();
		return;
	}

	const route = resolveScrollRoute(eventTarget, deltaY, composedPath);
	if (route.kind === 'native') {
		yieldWheelToNative();
		return;
	}
	if (route.kind === 'blocked') {
		// Containment boundary: prevent native scroll bleed but do NOT
		// clearQueue — a live animation on an outer target (e.g. window)
		// should continue smoothly. Only reset wheel input state.
		e.preventDefault();
		e.stopPropagation();
		resetWheelRuntimeState();
		return;
	}
	// The route already canonicalizes viewport ownership in this call stack.
	// The engine performs the final admission canonicalization, so repeating it
	// here would allocate another style reader on every admitted wheel.
	const target = route.target;
	// WheelEvent does not expose a trustworthy hardware identity. Fine-grained
	// streams keep their physical delta. Coarse wheel ticks add one configured
	// step while acceleration changes only the engine response; both retain the
	// same rAF owner.
	let newAcc = 1;
	if (inputMode === 'fine') {
		if (accelerationTarget) resetAcceleration();
	} else {
		const direction = Math.sign(deltaY);
		const continuingStream =
			accelerationTarget === target &&
			accelerationDirection === direction &&
			lastScrollTime !== null &&
			timestamp - lastScrollTime < settings.accelerationDelta;
		newAcc = continuingStream
			? Math.min(acceleration + 0.5, settings.accelerationMax)
			: 1;
	}

	if (inputMode === 'coarse' && Math.abs(deltaY) > 1.2) {
		deltaY = Math.sign(deltaY) * settings.stepSize;
	}

	if (
		!scrollTo(
			target,
			0,
			deltaY,
			route.admission,
			inputMode,
			performance.now(),
			newAcc,
		)
	) {
		yieldWheelToNative();
		return;
	}

	if (inputMode === 'coarse') {
		updateAcceleration(newAcc, timestamp, target, Math.sign(deltaY));
	}
	e.preventDefault();
}

export function onMouseDown(e: MouseEvent): void {
	if (!e.isTrusted) return;
	if (
		!settings.enabled ||
		!settings.middleClickAutoScroll ||
		e.defaultPrevented ||
		e.button !== 1
	) return;

	const eventTarget = e.target instanceof Element ? e.target : null;
	if (!eventTarget) return;
	const composedPath = wheelNeedsComposedPath(eventTarget)
		? e.composedPath()
		: undefined;
	const route = resolveDirectScrollRoute(eventTarget, composedPath);
	const target = route.kind === 'animate'
		? canonicalizeScrollTarget(route.target)
		: null;
	if (
		!target ||
		(!canScrollBy(target, 1) && !canScrollBy(target, -1))
	) return;

	e.preventDefault();
	clearQueue();
	resetWheelRuntimeState();
	state.isMiddleScrolling = true;
	state.middleScrollStartY = e.clientY;
	state.middleScrollTarget = target;
	state.middleScrollPreviousCursor = document.body.style.cursor;
	document.body.style.cursor = 'ns-resize';

	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', onMouseUp);
	window.addEventListener('blur', cancelMiddleScroll);
}

export function onMouseMove(e: MouseEvent): void {
	if (!e.isTrusted) return;
	if (!state.isMiddleScrolling || !state.middleScrollTarget) return;
	const deltaY = (e.clientY - state.middleScrollStartY) * 2;
	state.middleScrollStartY = e.clientY;
	if (!deltaY) return;

	if (
		!queueOwnedVerticalScroll(
			state.middleScrollTarget,
			deltaY,
			performance.now(),
			cancelMiddleScroll,
		)
	) {
		cancelMiddleScroll();
	}
}

export function onMouseUp(e: MouseEvent): void {
	if (!e.isTrusted) return;
	if (e.button === 1 && state.isMiddleScrolling) {
		releaseMiddleScroll(false);
	}
}

function releaseMiddleScroll(cancelAnimation: boolean): void {
	const wasActive = state.isMiddleScrolling;
	state.isMiddleScrolling = false;
	state.middleScrollTarget = null;
	if (document.body) document.body.style.cursor = state.middleScrollPreviousCursor;
	state.middleScrollPreviousCursor = '';
	window.removeEventListener('mousemove', onMouseMove);
	window.removeEventListener('mouseup', onMouseUp);
	window.removeEventListener('blur', cancelMiddleScroll);
	if (cancelAnimation && wasActive) clearQueue();
}

export function cancelMiddleScroll(): void {
	releaseMiddleScroll(true);
}

export function resetInputHandlers(): void {
	cancelMiddleScroll();
	resetKeyboardRuntime();
}
