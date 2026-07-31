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

// eff: HALO registers keydown in BUBBLE phase on window (see smooth-scroll.ts),
// the LAST stop in event propagation. Site listeners run before HALO.
//
// Key handling policy:
// - Video pages (visible main player): spacebar + arrow keys yield to site
//   completely. HALO calls preventDefault to suppress native instant scroll
//   (which feels like "paging"), then returns. The site owns these keys.
//   Determined by DOM-state video check (viewport ratio), NOT defaultPrevented,
//   because Bilibili changes volume via JS without preventDefault — relying on
//   defaultPrevented would cause HALO to scroll AND Bilibili to change volume
//   simultaneously (entanglement).
// - Arrow keys (non-video pages): identical code path to mouse wheel. No
//   throttling, no manual clearQueue, same acceleration logic (time-delta based).
//   OS key-repeat (~33ms) < accelerationDelta (50ms) → continuing stream →
//   acceleration builds up exactly like fast consecutive wheel ticks.
//   Engine backlog limit (maxBacklogPx) naturally caps accumulation, same as
//   wheel. This makes arrow keys feel identical to wheel.
// - Spacebar/PageUp/PageDown (non-video pages): discrete large jumps. clearQueue
//   ensures a clean animation per press. These are not continuous like wheel.
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

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

	// Video pages: spacebar + arrow keys belong to the site (play/pause,
	// volume, seek). HALO yields completely. preventDefault suppresses
	// native instant scroll (which feels like "paging"). PageUp/PageDown
	// are never handled by video sites, so HALO always processes them.
	const isVideoShortcutKey = e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp';
	if (isVideoShortcutKey && hasMainVideoPlayer()) {
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

	const direction = Math.sign(dy);
	const timestamp = performance.now();

	// Spacebar/PageUp/PageDown: discrete large jumps — clearQueue for a
	// clean animation per press. Arrow keys: continuous like wheel — no
	// clearQueue, let scrollTo handle direction changes internally.
	const isDiscreteJump = e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp';
	if (isDiscreteJump) {
		clearQueue();
		resetWheelRuntimeState();
	}

	const route = isGeneric
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);
	if (route.kind === 'blocked') {
		e.preventDefault();
		return;
	}
	if (route.kind !== 'animate') {
		return;
	}

	// Arrow keys: exact same acceleration logic as mouse wheel (time-delta
	// based, not e.repeat based). This makes long-press feel identical to
	// fast consecutive wheel ticks. Discrete jumps always use acc=1.
	let newAcc = 1;
	if (!isDiscreteJump) {
		const continuingStream =
			accelerationTarget === route.target &&
			accelerationDirection === direction &&
			lastScrollTime !== null &&
			timestamp - lastScrollTime < settings.accelerationDelta;
		newAcc = continuingStream
			? Math.min(acceleration + 0.5, settings.accelerationMax)
			: 1;
	}

	if (
		scrollTo(route.target, 0, dy, route.admission, 'coarse', timestamp, newAcc)
	) {
		e.preventDefault();
		updateAcceleration(newAcc, timestamp, route.target, direction);
	}
}
