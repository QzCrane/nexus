import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: Static factors for key direction. Spacebar scrolls one page (shift
// reverses), matching native behavior. HALO registers keydown in CAPTURE
// phase (see smooth-scroll.ts), so it runs BEFORE site listeners. This lets
// HALO stopPropagation() to prevent site players (YouTube, Bilibili) from
// executing direct side effects (pause, volume) when HALO scrolls.
// When HALO does NOT scroll, it leaves the event alone — site listeners and
// native behavior (play/pause, volume, feed pagination) work unchanged.
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

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
		// In capture phase, e.defaultPrevented means an earlier capture
		// listener (e.g. another extension) already claimed this event.
		// Respect it: do not scroll, let propagation continue.
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
		// Containment boundary: prevent native scroll bleed. Do not
		// stopPropagation — the site may still want the key for other actions.
		e.preventDefault();
		if (!e.repeat) clearQueue();
	} else if (
		route.kind === 'animate' &&
		scrollTo(route.target, 0, dy, route.admission)
	) {
		// HALO owns this key: prevent native scroll AND stop propagation so
		// site listeners never see the event (no double action: no pause,
		// no volume change, no feed pagination).
		e.preventDefault();
		e.stopPropagation();
	} else if (!e.repeat) {
		// No animatable target: HALO does not own the key. Leave the event
		// alone so the site and native behavior can proceed.
		clearQueue();
	}
}
