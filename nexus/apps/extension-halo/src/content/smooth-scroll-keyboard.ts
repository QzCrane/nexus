import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import {
	acceleration,
	accelerationDirection,
	accelerationTarget,
	lastScrollTime,
	resetWheelRuntimeState,
	settings,
	updateAcceleration,
} from './smooth-scroll-state';

// eff: HALO registers keydown in CAPTURE phase (see smooth-scroll.ts), running
// BEFORE any site bubble listener. This gives HALO first-mover control:
//
// - Arrow keys: stopPropagation in capture → site bubble listeners (Bilibili
//   volume, YouTube volume) NEVER fire. preventDefault → native HTML5 media
//   keyboard volume also suppressed. HALO smooth-scrolls. Result: arrows only
//   scroll, never tangle with volume.
//
// - Spacebar: do NOT stopPropagation (let site play/pause fire). preventDefault
//   in capture → suppresses native browser scroll (spacebar page-down). Site
//   listeners still run because preventDefault does not stop propagation. On
//   video pages the site toggles playback; on non-video pages HALO scrolls.
//
// - PageUp/PageDown: stopPropagation + preventDefault + smooth scroll.
//
// Acceleration: keyboard reuses the SAME acceleration state as mouse wheel
// (acceleration/accelerationTarget/accelerationDirection/lastScrollTime in
// smooth-scroll-state.ts). This makes single arrow press feel identical to a
// single wheel tick (same dy, same responseMultiplier=1, same inputMode=coarse),
// and long-press feel like continuous wheel scrolling (acceleration ramps up
// with the same +0.5/step curve, capped at accelerationMax). The only
// difference is the input interval: OS key repeat fires faster than physical
// wheel ticks, so we use accelerationDelta as the stream-continuity threshold
// — if two key events are farther apart than accelerationDelta, acceleration
// resets to 1 (treated as a new gesture, just like lifting the wheel).
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

// Reset keyboard module runtime state. Called by resetInputHandlers() in
// smooth-scroll-handlers.ts so tests and page lifecycle events
// (pagehide/visibilitychange) clear any module-level state together.
export function resetKeyboardRuntime(): void {
	// Stateless module — no-op placeholder preserves the
	// resetInputHandlers() contract for future state additions.
}

export function onKeydown(e: KeyboardEvent): void {
	if (!e.isTrusted) return;
	const keyFactor = KEYS[e.key];
	if (keyFactor === undefined) return;

	if (
		!settings.enabled ||
		!settings.keyboard ||
		e.ctrlKey ||
		e.altKey ||
		e.metaKey ||
		shouldIgnoreInput(document.activeElement) ||
		document.fullscreenElement ||
		(settings.respectReducedMotion && prefersReducedMotion())
	) {
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	const isSpacebar = e.key === ' ';
	// Arrows and PageUp/Down: HALO claims the event in capture phase.
	// stopPropagation prevents ALL site bubble listeners from firing (Bilibili
	// volume JS, YouTube volume JS, feed pagination, etc.). This is the only
	// reliable way to prevent tangling — Bilibili changes volume WITHOUT calling
	// preventDefault, so defaultPrevented-based detection cannot work.
	// Spacebar: do NOT stopPropagation — site play/pause must fire.
	const shouldStopPropagation = !isSpacebar;

	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;

	const step = settings.arrowKeyStep;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (e.key === 'PageDown') dy = page;
	else if (e.key === 'PageUp') dy = -page;
	else if (e.key === ' ') dy = e.shiftKey ? -page : page;
	else dy = keyFactor * step;

	const timestamp = performance.now();
	const target = isGeneric ? null : active;

	// Acceleration: same logic as mouse wheel (smooth-scroll-handlers.ts).
	// A continuing stream (same target+direction, within accelerationDelta ms
	// of the last event) ramps up responseMultiplier by 0.5 per event, capped
	// at accelerationMax. A new gesture resets to 1. This makes long-press
	// feel like continuous wheel scrolling — gradually faster, not instantly
	// maxed — and single press identical to a single wheel tick.
	const direction = Math.sign(dy);
	const continuingStream =
		(target === null
			? accelerationTarget !== null
			: accelerationTarget === target) &&
		accelerationDirection === direction &&
		lastScrollTime !== null &&
		timestamp - lastScrollTime < settings.accelerationDelta;
	const responseMultiplier = continuingStream
		? Math.min(acceleration + 0.5, settings.accelerationMax)
		: 1;

	// Long-press repeats (e.repeat) must NOT clearQueue: each repeat would
	// reset the animation to frame zero, making long-press feel frozen.
	// Instead, let scrollTo accumulate into the live engine queue — engine
	// already clears on direction/target change. First press clears stale state.
	if (!e.repeat) {
		clearQueue();
		resetWheelRuntimeState();
	}
	const route = isGeneric
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);

	if (shouldStopPropagation) {
		// Arrows/PageUp/PageDown: block site bubble listeners (volume, etc.)
		e.stopPropagation();
	}

	if (route.kind === 'blocked') {
		e.preventDefault();
		if (!e.repeat) clearQueue();
	} else if (
		route.kind === 'animate' &&
		scrollTo(
			route.target,
			0,
			dy,
			route.admission,
			'coarse',
			timestamp,
			responseMultiplier,
		)
	) {
		// HALO smooth-scrolls. preventDefault suppresses native instant scroll
		// (spacebar page-down, arrow scroll, HTML5 media keyboard volume).
		e.preventDefault();
		// Update acceleration state so the next event can continue the stream.
		// Use the resolved route target (may be window, not the active element).
		updateAcceleration(responseMultiplier, timestamp, route.target, direction);
	} else if (!e.repeat) {
		clearQueue();
	}
}
