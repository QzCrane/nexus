import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: HALO registers keydown in CAPTURE phase (see smooth-scroll.ts), so it
// runs BEFORE site listeners. This lets HALO stopPropagation on arrow keys
// to prevent site volume shortcuts (YouTube/Bilibili) when the user wants to
// scroll, while spacebar never stopPropagation so site play/pause still works.
//
// Video page detection: a page counts as a "video page" when a <video>
// element exists in the DOM (regardless of viewport visibility). This is
// reliable even after the user scrolls and the player leaves the viewport —
// the <video> element stays in the DOM. YouTube/Bilibili home feeds use
// <img> thumbnails (no <video> until hover-preview), so arrows/spacebar
// scroll normally there.
//
// Yield strategy (per key):
// - Spacebar: yield on video pages (user wants play/pause). preventDefault
//   suppresses native scroll; no stopPropagation so site listeners fire.
// - Arrow keys: yield ONLY when <video> is the active element (native HTML5
//   volume control). When video is NOT focused, arrows scroll — even on
//   video pages — so the user can scroll comments/feed. stopPropagation
//   prevents site volume shortcuts from double-firing.
// - PageUp/PageDown: never yield (don't control video; needed for paging).
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

function hasPlayerVideo(): boolean {
	// querySelector is O(1) short-circuit on first match and cheaper than
	// getElementsByTagName+getBoundingClientRect. No TTL cache needed: DOM
	// mutations between key repeats are rare and querySelector is fast.
	return document.querySelector('video') !== null;
}

// Reset keyboard module runtime state. Called by resetInputHandlers() in
// smooth-scroll-handlers.ts so tests and page lifecycle events
// (pagehide/visibilitychange) clear any module-level state together.
export function resetKeyboardRuntime(): void {
	// No-op placeholder: hasPlayerVideo() is stateless, but keeping this
	// export preserves the resetInputHandlers() contract for future
	// module-level state additions.
}

function isVideoFocused(): boolean {
	const active = document.activeElement;
	return active !== null && active.tagName === 'VIDEO';
}

export function onKeydown(e: KeyboardEvent): void {
	if (!e.isTrusted) return;
	const keyFactor = KEYS[e.key];
	if (keyFactor === undefined) return;

	const isSpacebar = e.key === ' ';
	const isArrowKey = e.key === 'ArrowDown' || e.key === 'ArrowUp';
	const onVideoPage = hasPlayerVideo();

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
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Arrow keys + video focused: yield to native HTML5 media keyboard
	// (volume control). No preventDefault (let native volume work), no
	// stopPropagation (let site listeners work). HALO does nothing.
	if (isArrowKey && isVideoFocused()) {
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Spacebar on a video page: yield to site play/pause. preventDefault
	// suppresses browser native scroll (some sites like YouTube don't
	// preventDefault themselves). No stopPropagation — site listeners must
	// fire to toggle playback.
	if (isSpacebar && onVideoPage) {
		e.preventDefault();
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Arrow keys on a video page (video NOT focused): the user wants to
	// scroll the page (comments, feed), not control volume. stopPropagation
	// prevents site volume shortcuts (YouTube/Bilibili document-level
	// listeners) from firing, so only HALO's scroll happens. Capture phase:
	// HALO runs first, so stopPropagation actually blocks site bubble
	// listeners. This also covers the case where the player has scrolled
	// out of viewport — the <video> element is still in the DOM.
	if (isArrowKey && onVideoPage) {
		e.stopPropagation();
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
	if (route.kind === 'blocked') {
		e.preventDefault();
		if (!e.repeat) clearQueue();
	} else if (
		route.kind === 'animate' &&
		scrollTo(route.target, 0, dy, route.admission)
	) {
		// HALO scrolls: preventDefault to suppress native instant scroll.
		e.preventDefault();
	} else if (!e.repeat) {
		clearQueue();
	}
}
