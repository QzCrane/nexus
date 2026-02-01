import { shouldIgnoreInput, findScrollTargetChained, findMainScrollTarget, canScrollBy, isSuspiciousList } from '../tools/smooth-scroll/utils';
import { scrollTo } from '../tools/smooth-scroll/engine';
import { settings } from './smooth-scroll-state';

// eff: Static factors for key direction
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0, ' ': 0
};

function isBlockingVideo(): boolean {
	const videos = document.getElementsByTagName('video');
	for (let i = 0, len = videos.length; i < len; i++) {
		const v = videos[i];
		if (!v) continue; // Static check
		const rect = v.getBoundingClientRect();
		// Skip tiny/invisible
		if (rect.width < 50 || rect.height < 50 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
		// Playing or Large (20% viewport)
		if ((!v.paused && !v.ended && v.readyState > 2) || (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.2)) return true;
	}
	return false;
}

export function onKeydown(e: KeyboardEvent): void {
	if (!settings.enabled || !settings.keyboard || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
	if (shouldIgnoreInput(document.activeElement)) return;

	const keyFactor = KEYS[e.key];
	if (keyFactor === undefined) return;

	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;

	// rule: Yield to video players if generic focus
	const hasVideo = isGeneric && isBlockingVideo();
	if (hasVideo) return; // Yield to native or site's own video handler

	const step = settings.arrowKeyStep;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (e.key === ' ') dy = e.shiftKey ? -page : page;
	else if (e.key === 'PageDown') dy = page;
	else if (e.key === 'PageUp') dy = -page;
	else dy = keyFactor * step;

	const target = isGeneric ? findMainScrollTarget(dy) : findScrollTargetChained(active, dy);
	if (target !== window && isSuspiciousList(target as Element)) return;

	if (canScrollBy(target, dy)) {
		e.preventDefault();
		scrollTo(target, 0, dy);
	}
}
