import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: Static factors for key direction
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0, ' ': 0
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
		clearQueue();
		resetWheelRuntimeState();
		return;
	}

	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;

	const step = settings.arrowKeyStep;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (e.key === ' ') dy = e.shiftKey ? -page : page;
	else if (e.key === 'PageDown') dy = page;
	else if (e.key === 'PageUp') dy = -page;
	else dy = keyFactor * step;

	clearQueue();
	resetWheelRuntimeState();
	const route = isGeneric
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);
	if (route.kind === 'blocked') {
		e.preventDefault();
		clearQueue();
	} else if (
		route.kind === 'animate' &&
		scrollTo(route.target, 0, dy, route.admission)
	) {
		e.preventDefault();
	} else {
		clearQueue();
	}
}
