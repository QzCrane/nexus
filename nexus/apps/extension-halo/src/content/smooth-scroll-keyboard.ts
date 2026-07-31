import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: Static factors for key direction
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0, ' ': 0
};

// eff: Detects whether the viewport currently shows a video large enough to be a
// media target. When true, the spacebar is yielded to the browser/site so its
// native play/pause handling runs instead of HALO scrolling the page.
function hasVisibleVideo(): boolean {
	const videos = document.querySelectorAll('video');
	if (videos.length === 0) return false;
	for (let i = 0; i < videos.length; i++) {
		const rect = (videos[i] as HTMLElement).getBoundingClientRect();
		if (
			rect.width > 50 &&
			rect.height > 50 &&
			rect.top < window.innerHeight &&
			rect.bottom > 0
		) {
			return true;
		}
	}
	return false;
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
		clearQueue();
		resetWheelRuntimeState();
		return;
	}

	// Yield spacebar to the page's video play/pause handling when a visible
	// video is on screen. Browser default and site keydown handlers will toggle
	// playback; HALO must not preventDefault or scroll in this case.
	if (e.key === ' ' && hasVisibleVideo()) {
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
