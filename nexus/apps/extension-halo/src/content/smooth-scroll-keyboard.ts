import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import { resetWheelRuntimeState, settings } from './smooth-scroll-state';

// eff: Static factors for key direction
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0, ' ': 0
};

// eff: Finds the most visible video intersecting the viewport. Used to route
// the spacebar to play/pause instead of page scroll on video pages. Returns
// null when no video larger than 50x50px is visible.
function findActiveVideo(): HTMLVideoElement | null {
	const videos = document.querySelectorAll('video');
	let best: HTMLVideoElement | null = null;
	let bestArea = 0;
	for (let i = 0; i < videos.length; i++) {
		const v = videos[i] as HTMLVideoElement;
		const rect = v.getBoundingClientRect();
		if (
			rect.width > 50 &&
			rect.height > 50 &&
			rect.top < window.innerHeight &&
			rect.bottom > 0
		) {
			const area = rect.width * rect.height;
			if (area > bestArea) {
				bestArea = area;
				best = v;
			}
		}
	}
	return best;
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

	// On video pages the spacebar should toggle play/pause, not scroll. The
	// browser default scrolls the page when focus is on body; site keydown
	// handlers may or may not handle it. Since we reached here the site has not
	// preventDefault'd, so HALO prevents the scroll and toggles the most
	// visible video. Focus on a <video> element was already yielded above via
	// shouldIgnoreInput, so there is no double-toggle with native handling.
	if (e.key === ' ') {
		const video = findActiveVideo();
		if (video) {
			e.preventDefault();
			if (video.paused) {
				void video.play().catch((error: unknown) => {
					console.debug('[HALO:Scroll] spacebar autoplay was unavailable', error);
				});
			} else {
				video.pause();
			}
			clearQueue();
			resetWheelRuntimeState();
			return;
		}
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
