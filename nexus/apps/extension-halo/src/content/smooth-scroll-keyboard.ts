import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: HALO registers keydown in BUBBLE phase on window (see smooth-scroll.ts),
// the LAST stop in event propagation. Site listeners (YouTube on document,
// Bilibili on window) run before HALO and call preventDefault when they handle
// the key (play/pause, volume, feed pagination). HALO checks e.defaultPrevented:
//   - true  → site claimed it; HALO yields (no scroll, no preventDefault,
//             no stopPropagation — do nothing).
//   - false → site did not claim it; HALO smooth-scrolls and preventDefault
//             to suppress native instant scroll.
//
// This is a single, uniform rule for ALL keys (spacebar, arrows, PageUp/Down).
// No video detection, no focus detection, no viewport-ratio heuristics — those
// were all unreliable (video tabIndex=-1 never focuses; hover-preview <video>
// on home feeds triggers false positives). defaultPrevented is the only
// signal that accurately reflects the site's actual handling of the event.
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
		e.defaultPrevented ||
		e.ctrlKey ||
		e.altKey ||
		e.metaKey ||
		shouldIgnoreInput(document.activeElement) ||
		document.fullscreenElement ||
		(settings.respectReducedMotion && prefersReducedMotion())
	) {
		// e.defaultPrevented: a site listener (YouTube/Bilibili) already
		// claimed this event for play/pause/volume/shortcuts. HALO yields.
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
		// Site did not claim the event (defaultPrevented is false). HALO
		// smooth-scrolls. preventDefault suppresses native instant scroll.
		// No stopPropagation — other bubble listeners may still need it.
		e.preventDefault();
	} else if (!e.repeat) {
		clearQueue();
	}
}
