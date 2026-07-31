import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: Static factors for key direction. Spacebar scrolls one page (shift
// reverses), matching native behavior. HALO registers keydown in BUBBLE
// phase (see smooth-scroll.ts): site listeners run first and may claim the
// event via preventDefault (e.g. YouTube/Bilibili player shortcuts, feed
// pagination). HALO checks e.defaultPrevented and yields when claimed.
// Additionally, spacebar and arrow keys yield when a visible player-sized
// video is on screen, so site/native play/pause and volume control work.
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

// Threshold: a video counts as a "player" (spacebar/arrows should yield to
// play/pause/volume) when its visible area covers at least 20% of the
// viewport. This excludes preview thumbnails on home feeds.
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
		// e.defaultPrevented: a site listener (bubble phase, ran before HALO)
		// already claimed this event (e.g. YouTube shortcut, feed pagination).
		// Respect it: do not scroll.
		if (!e.repeat) {
			clearQueue();
			resetWheelRuntimeState();
		}
		return;
	}

	// Spacebar and arrow keys yield when a visible player-sized video is on
	// screen: the user most likely wants play/pause (space) or volume control
	// (arrows — native HTML5 media keyboard behavior), not page scroll.
	// PageUp/PageDown do NOT yield — they don't control video and long-document
	// pagination needs them.
	//
	// preventDefault is called to suppress browser native scroll: some sites
	// (e.g. YouTube) handle shortcuts WITHOUT calling preventDefault, so the
	// browser would also natively scroll — causing double-action. HALO's
	// preventDefault only stops the browser default; site listeners already
	// ran in bubble phase and are unaffected.
	if ((isSpacebar || isArrowKey) && hasVisiblePlayerVideo()) {
		e.preventDefault();
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

	// Long-press repeats (e.repeat) must NOT clearQueue: each repeat would
	// reset the animation to frame zero, making long-press feel frozen.
	// Instead, let scrollTo accumulate into the live engine queue — engine
	// already clears on direction/target change. First press clears stale state.
	//
	// No responseMultiplier acceleration: keyboard repeat is OS-auto-fired at
	// ~30Hz, not a user-expressed acceleration intent. Long-press speed-up
	// comes naturally from engine backlog accumulation (capped by
	// maxBacklogPx), keeping the feel identical to a single press. This makes
	// single arrow press == single wheel tick (same dy, same inputMode, same
	// responseMultiplier=1), so the two feel exactly alike.
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
		// No stopPropagation — site listeners already ran in bubble phase.
		e.preventDefault();
	} else if (!e.repeat) {
		clearQueue();
	}
}
