import { shouldIgnoreInput, findScrollTargetChained, findMainScrollTarget, canScrollBy } from '../tools/smooth-scroll/utils';
import { scrollTo } from '../tools/smooth-scroll/engine';
import { settings } from './smooth-scroll-state';

export function onKeydown(e: KeyboardEvent): void {
	if (!settings.enabled || !settings.keyboard) return;

	// Conflict: If site already handled it (e.g. video control), do not scroll
	if (e.defaultPrevented) return;

	if (e.ctrlKey || e.altKey || e.metaKey) return;

	if (shouldIgnoreInput(document.activeElement)) return;

	// Keyboard always assumes vertical scroll roughly

	// rule: If focus is generic (body/html), probe for the real main scroller ONLY if safer to do so.
	// AI Chats need Deep Probe. Video sites need to respect standard flow (prevent double-scroll).
	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;
	// Guard: Video Page Detection
	// rule: Only yield to native video controls if the video is "prominent" (playing or large)
	let isVideoGeneric = false;
	if (isGeneric) {
		const videos = document.getElementsByTagName('video');
		for (let i = 0; i < videos.length; i++) {
			const video = videos[i];
			if (!video) continue;
			const rect = video.getBoundingClientRect();

			// 1. Ignore tiny/hidden videos
			if (rect.width < 50 || rect.height < 50) continue;

			// 2. Logic: If Playing -> Yield (Control). If Large & Visible -> Yield (Control).
			const isPlaying = !video.paused && !video.ended && video.readyState > 2;
			const isLarge = (rect.width * rect.height) > (window.innerWidth * window.innerHeight * 0.2); // 20%
			const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;

			if (isPlaying || (isLarge && isVisible)) {
				isVideoGeneric = true;
				break;
			}
		}
	}

	let target: Element | Window;

	if (isGeneric) {
		// If video exists, use standard probe (avoid digging into player internals or hidden divs)
		// If no video (standard site/AI Chat), use Deep Probe to find the chat/article
		if (isVideoGeneric) {
			target = findScrollTargetChained(active, 100);
		} else {
			target = findMainScrollTarget(100);
		}
	} else {
		target = findScrollTargetChained(active, 100);
	}

	if (!canScrollBy(target, 100)) return;

	const pageHeight = window.innerHeight * 0.9;
	let deltaY = 0;

	// inv: Trust defaultPrevented to handle video player shortcuts.
	// shouldIgnoreInput now handles the player wrapper focus case.

	switch (e.key) {
		case 'ArrowDown':
			if (isVideoGeneric) return; // Yield to Video Logic
			deltaY = settings.arrowKeyStep;
			break;
		case 'ArrowUp':
			if (isVideoGeneric) return; // Yield to Video Logic
			deltaY = -settings.arrowKeyStep;
			break;
		case 'PageDown':
			if (isVideoGeneric) return; // Yield to Video Logic
			deltaY = pageHeight;
			break;
		case 'PageUp':
			if (isVideoGeneric) return; // Yield to Video Logic
			deltaY = -pageHeight;
			break;
		case ' ':
			// Spacebar is tricky. Video sites usually preventDefault it.
			if (isVideoGeneric) return; // Yield to Video Logic
			// If not, it means scroll.
			deltaY = e.shiftKey ? -pageHeight : pageHeight;
			break;
		default: return;
	}

	e.preventDefault();
	scrollTo(target, 0, deltaY);
}
