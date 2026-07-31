import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import {
	acceleration,
	accelerationDirection,
	accelerationTarget,
	resetWheelRuntimeState,
	settings,
	updateAcceleration,
} from './smooth-scroll-state';

// eff: HALO registers keydown in BUBBLE phase on window (see smooth-scroll.ts),
// the LAST stop in event propagation. Site listeners run before HALO.
//
// Key handling policy:
// - Spacebar on video pages (visible main player): HALO yields completely.
//   Spacebar is always play/pause on video pages. Determined by DOM-state
//   video check (viewport ratio), NOT defaultPrevented, because sites may
//   handle spacebar without preventDefault.
// - Arrow keys: HALO checks e.defaultPrevented ONLY. YouTube preventDefaults
//   arrows for volume control → HALO yields. Bilibili does NOT preventDefault
//   arrows (JS changes volume without preventDefault) → HALO smooth-scrolls.
//   This is the desired behavior: YouTube arrows = volume, Bilibili arrows =
//   scroll (when focus is not on the player; shouldIgnoreInput handles the
//   player-focus case via VIDEO tag in IGNORE_TAGS).
// - PageUp/PageDown: never handled by sites. HALO always smooth-scrolls.
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

// Throttle long-press key repeats to match mouse-wheel tick frequency.
// OS key-repeat fires every ~33ms; mouse-wheel ticks fire every ~80-120ms.
// Without throttling, long-press accumulation is 3x faster than wheel,
// making long-press feel "too fast" vs. wheel. Throttling to 80ms makes
// per-tick accumulation cadence match wheel feel. Direction changes bypass
// throttle so the first press in a new direction is always immediate.
const KEY_REPEAT_MIN_INTERVAL_MS = 80;
let lastKeyScrollTime = 0;
let lastKeyScrollDirection = 0;

// A video counts as a "main player" when it occupies a significant fraction
// of the viewport. This distinguishes real video pages (YouTube/Bilibili
// watch pages, where space/arrows belong to the player) from thumbnail
// preview videos that appear on hover (YouTube homepage previews, which
// should NOT steal keyboard scrolling).
// 50% viewport coverage catches player videos (typically 60-100% of
// viewport) while excluding preview videos (typically <25% of viewport).
const VIDEO_VIEWPORT_RATIO = 0.5;

function hasMainVideoPlayer(): boolean {
	if (typeof document === 'undefined') return false;
	const videos = document.getElementsByTagName('video');
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	for (let i = 0; i < videos.length; i++) {
		const v = videos[i] as HTMLElement;
		if (
			v.clientWidth >= vw * VIDEO_VIEWPORT_RATIO ||
			v.clientHeight >= vh * VIDEO_VIEWPORT_RATIO
		) {
			return true;
		}
	}
	return false;
}

// Reset keyboard module runtime state. Called by resetInputHandlers() in
// smooth-scroll-handlers.ts so tests and page lifecycle events
// (pagehide/visibilitychange) clear any module-level state together.
export function resetKeyboardRuntime(): void {
	lastKeyScrollTime = 0;
	lastKeyScrollDirection = 0;
}

export function onKeydown(e: KeyboardEvent): void {
	if (!e.isTrusted) return;
	const keyFactor = KEYS[e.key];
	if (keyFactor === undefined) return;

	if (
		!settings.enabled ||
		!settings.keyboard ||
		e.defaultPrevented ||
		e.ctrlKey ||
		e.altKey ||
		e.metaKey ||
		shouldIgnoreInput(document.activeElement) ||
		document.fullscreenElement ||
		(settings.respectReducedMotion && prefersReducedMotion())
	) {
		// e.defaultPrevented: a site listener already claimed this event.
		// HALO yields.
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Spacebar on video pages: always play/pause. Determined by DOM-state
	// video check, not defaultPrevented (sites may handle space without
	// preventDefault). Arrow keys are NOT gated here — they rely on
	// defaultPrevented (YouTube preventDefaults, Bilibili does not).
	if (e.key === ' ' && hasMainVideoPlayer()) {
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;

	const step = settings.arrowKeyStep;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (e.key === 'PageDown') dy = page;
	else if (e.key === 'PageUp') dy = -page;
	else if (e.key === ' ') dy = e.shiftKey ? -page : page;
	else dy = keyFactor * step;

	// Throttle same-direction long-press repeats to match wheel tick cadence.
	const direction = Math.sign(dy);
	const timestamp = performance.now();
	if (
		e.repeat &&
		direction === lastKeyScrollDirection &&
		timestamp - lastKeyScrollTime < KEY_REPEAT_MIN_INTERVAL_MS
	) {
		// Suppress native scroll but don't accumulate — wait for next throttle window.
		e.preventDefault();
		return;
	}
	lastKeyScrollTime = timestamp;
	lastKeyScrollDirection = direction;

	// First press clears stale state; repeats accumulate into the live queue.
	if (!e.repeat) {
		clearQueue();
		resetWheelRuntimeState();
	}
	const route = isGeneric
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);
	if (route.kind === 'blocked') {
		e.preventDefault();
		if (!e.repeat) clearQueue();
		return;
	}
	if (route.kind !== 'animate') {
		if (!e.repeat) clearQueue();
		return;
	}

	// Acceleration: same mechanism as mouse wheel. Long-press repeats build
	// up responseMultiplier so the spring tightens, matching wheel feel.
	const continuingStream =
		e.repeat &&
		accelerationTarget === route.target &&
		accelerationDirection === direction;
	const newAcc = continuingStream
		? Math.min(acceleration + 0.5, settings.accelerationMax)
		: 1;

	if (
		scrollTo(route.target, 0, dy, route.admission, 'coarse', timestamp, newAcc)
	) {
		// Site did not claim the event. HALO smooth-scrolls. preventDefault
		// suppresses native instant scroll. No stopPropagation — other
		// bubble listeners may still need it.
		e.preventDefault();
		updateAcceleration(newAcc, timestamp, route.target, direction);
	} else if (!e.repeat) {
		clearQueue();
	}
}
