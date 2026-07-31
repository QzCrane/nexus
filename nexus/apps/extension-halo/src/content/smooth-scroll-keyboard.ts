import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: HALO registers keydown in CAPTURE phase (see smooth-scroll.ts), so it
// runs BEFORE site listeners. This lets HALO stopPropagation on arrow keys
// to prevent site volume shortcuts (YouTube/Bilibili) when the user wants to
// scroll, while spacebar never stopPropagation so site play/pause still works.
//
// Yield strategy (per key):
// - Spacebar: yield when a player-sized video is visible (user wants
//   play/pause). preventDefault suppresses native scroll; no stopPropagation
//   so site listeners still fire.
// - Arrow keys: yield ONLY when <video> is the active element (user wants
//   volume control via native HTML5 media keyboard). When video is NOT
//   focused, arrows always scroll — even on video pages — so the user can
//   scroll comments/feed. stopPropagation prevents site volume shortcuts
//   from double-firing.
// - PageUp/PageDown: never yield (don't control video; needed for paging).
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

// Threshold: a video counts as a "player" (spacebar should yield to
// play/pause) when its visible area covers at least 20% of the viewport.
// This excludes preview thumbnails on home feeds.
const VIDEO_VIEWPORT_RATIO = 0.2;

// TTL cache for hasVisiblePlayerVideo: long-press key repeat fires at ~30Hz,
// and re-running getElementsByTagName+getBoundingClientRect on every repeat
// is wasteful. 500ms TTL is short enough to react to video load/unload and
// long enough to cover a typical key repeat burst.
const VIDEO_CACHE_TTL_MS = 500;
let videoCacheResult = false;
let videoCacheExpiry = 0;

function hasVisiblePlayerVideo(): boolean {
	const now = performance.now();
	if (now < videoCacheExpiry) return videoCacheResult;
	const videos = document.getElementsByTagName('video');
	const viewportArea = window.innerWidth * window.innerHeight;
	let result = false;
	for (const video of videos) {
		const rect = video.getBoundingClientRect();
		const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(0, rect.left));
		const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.top));
		const visibleArea = visibleWidth * visibleHeight;
		if (visibleArea / viewportArea >= VIDEO_VIEWPORT_RATIO) {
			result = true;
			break;
		}
	}
	videoCacheResult = result;
	videoCacheExpiry = now + VIDEO_CACHE_TTL_MS;
	return result;
}

// Reset keyboard module runtime state (video cache). Called by
// resetInputHandlers() in smooth-scroll-handlers.ts so tests and page
// lifecycle events (pagehide/visibilitychange) clear the cache together.
export function resetKeyboardRuntime(): void {
	videoCacheResult = false;
	videoCacheExpiry = 0;
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

	// Spacebar + player-sized video visible: yield to site play/pause.
	// preventDefault suppresses browser native scroll (some sites like
	// YouTube don't preventDefault themselves). No stopPropagation — site
	// listeners must fire to toggle playback.
	if (isSpacebar && hasVisiblePlayerVideo()) {
		e.preventDefault();
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Arrow keys scrolling on a video page (video NOT focused): the user
	// wants to scroll the page (comments, feed), not control volume.
	// stopPropagation prevents site volume shortcuts (YouTube/Bilibili
	// document-level listeners) from firing, so only HALO's scroll happens.
	// Capture phase: HALO runs first, so stopPropagation actually blocks
	// site bubble listeners.
	if (isArrowKey && hasVisiblePlayerVideo()) {
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
