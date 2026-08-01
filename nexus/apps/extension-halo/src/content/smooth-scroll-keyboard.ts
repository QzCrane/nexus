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

// Keyboard ownership is key-specific:
// - ArrowUp/ArrowDown run in capture phase. HALO claims them only after it
//   resolves and admits a page scroll target. A media surface that acquired
//   interaction through pointer or focus keeps the arrows for volume/seek.
// - Space/PageUp/PageDown run in bubble phase so page handlers get first
//   refusal through defaultPrevented. Space keeps the existing visible-player
//   play/pause policy; page keys remain discrete page jumps.
//
// This deliberately never treats "a video exists on the page" as arrow-key
// ownership. Presence, playback, and viewport size are page state, not focus.
const ARROW_FACTORS: Record<string, number> = {
	ArrowDown: 1,
	ArrowUp: -1,
};

const BUBBLE_KEYS: Record<string, number> = {
	PageDown: 0,
	PageUp: 0,
	' ': 0,
};

const VIDEO_VIEWPORT_RATIO = 0.5;
const MEDIA_SELECTOR = 'video, audio';
let activeMediaInteraction: Element | null = null;

function isMediaElement(element: Element): boolean {
	return element.tagName === 'VIDEO' || element.tagName === 'AUDIO';
}

function isGenericFocus(element: Element | null): boolean {
	return !element || element === document.body || element === document.documentElement;
}

function mediaOwnedByFocus(element: Element | null): Element | null {
	if (!element || element === document.body || element === document.documentElement) {
		return null;
	}
	if (isMediaElement(element)) return element;
	return element.querySelector(MEDIA_SELECTOR);
}

function pointedMedia(event: PointerEvent): Element | null {
	for (const target of event.composedPath()) {
		if (target instanceof Element && isMediaElement(target)) return target;
	}

	if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
		return null;
	}

	for (const tagName of ['video', 'audio']) {
		const media = document.getElementsByTagName(tagName);
		for (let index = 0; index < media.length; index++) {
			const candidate = media[index];
			if (!candidate) continue;
			const rect = candidate.getBoundingClientRect();
			if (
				rect.width > 0 &&
				rect.height > 0 &&
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			) {
				return candidate;
			}
		}
	}

	return null;
}

function acquireMediaInteraction(media: Element | null): void {
	if (media === activeMediaInteraction) return;
	activeMediaInteraction = media;
	if (media) {
		clearQueue();
		resetWheelRuntimeState();
	}
}

export function onKeyboardPointerDown(event: PointerEvent): void {
	if (!event.isTrusted) return;
	acquireMediaInteraction(pointedMedia(event));
}

export function onKeyboardFocusIn(event: FocusEvent): void {
	const target = event.composedPath().find(
		(candidate): candidate is Element => candidate instanceof Element,
	) ?? null;
	acquireMediaInteraction(mediaOwnedByFocus(target));
}

function mediaOwnsArrowKeys(): boolean {
	if (activeMediaInteraction && !activeMediaInteraction.isConnected) {
		activeMediaInteraction = null;
	}
	if (activeMediaInteraction) return true;

	const focusedMedia = mediaOwnedByFocus(document.activeElement);
	if (!focusedMedia) return false;
	activeMediaInteraction = focusedMedia;
	return true;
}

function hasMainVideoPlayer(): boolean {
	if (typeof document === 'undefined') return false;
	const videos = document.getElementsByTagName('video');
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	for (let index = 0; index < videos.length; index++) {
		const video = videos[index] as HTMLElement;
		if (
			video.clientWidth >= viewportWidth * VIDEO_VIEWPORT_RATIO ||
			video.clientHeight >= viewportHeight * VIDEO_VIEWPORT_RATIO
		) {
			return true;
		}
	}
	return false;
}

function shouldYieldKeyboardEvent(event: KeyboardEvent): boolean {
	return (
		!settings.enabled ||
		!settings.keyboard ||
		event.defaultPrevented ||
		event.ctrlKey ||
		event.altKey ||
		event.metaKey ||
		shouldIgnoreInput(document.activeElement) ||
		document.fullscreenElement !== null ||
		(settings.respectReducedMotion && prefersReducedMotion())
	);
}

function resetInputStreamOnFirstPress(event: KeyboardEvent): void {
	if (event.repeat) return;
	clearQueue();
	resetWheelRuntimeState();
}

// Capture-phase owner for continuous arrow scrolling. stopPropagation is
// intentionally delayed until scrollTo accepts the target: HALO never blocks a
// page shortcut when it cannot actually provide the requested scroll.
export function onArrowKeydownCapture(event: KeyboardEvent): void {
	if (!event.isTrusted) return;
	const keyFactor = ARROW_FACTORS[event.key];
	if (keyFactor === undefined) return;

	if (shouldYieldKeyboardEvent(event) || mediaOwnsArrowKeys()) {
		resetInputStreamOnFirstPress(event);
		return;
	}

	const dy = keyFactor * settings.arrowKeyStep;
	const direction = Math.sign(dy);
	const timestamp = performance.now();
	const active = document.activeElement;
	const route = isGenericFocus(active)
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);

	if (route.kind === 'blocked') {
		event.preventDefault();
		return;
	}
	if (route.kind !== 'animate') return;

	const continuingStream =
		accelerationTarget === route.target &&
		accelerationDirection === direction &&
		lastScrollTime !== null &&
		timestamp - lastScrollTime < settings.accelerationDelta;
	const newAcceleration = continuingStream
		? Math.min(acceleration + 0.5, settings.accelerationMax)
		: 1;

	if (
		!scrollTo(
			route.target,
			0,
			dy,
			route.admission,
			'coarse',
			timestamp,
			newAcceleration,
		)
	) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	updateAcceleration(newAcceleration, timestamp, route.target, direction);
}

// Bubble-phase owner for discrete page keys. Arrow keys are excluded here so
// the capture decision remains the only arrow-key authority.
export function onKeydown(event: KeyboardEvent): void {
	if (!event.isTrusted) return;
	const keyFactor = BUBBLE_KEYS[event.key];
	if (keyFactor === undefined) return;

	if (shouldYieldKeyboardEvent(event)) {
		resetInputStreamOnFirstPress(event);
		return;
	}

	if (event.key === ' ' && hasMainVideoPlayer()) {
		event.preventDefault();
		resetInputStreamOnFirstPress(event);
		return;
	}

	const active = document.activeElement;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (event.key === 'PageDown') dy = page;
	else if (event.key === 'PageUp') dy = -page;
	else if (event.key === ' ') dy = event.shiftKey ? -page : page;
	else dy = keyFactor * settings.arrowKeyStep;

	clearQueue();
	resetWheelRuntimeState();

	const route = isGenericFocus(active)
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);
	if (route.kind === 'blocked') {
		event.preventDefault();
		return;
	}
	if (route.kind !== 'animate') return;

	const timestamp = performance.now();
	if (
		scrollTo(route.target, 0, dy, route.admission, 'coarse', timestamp, 1)
	) {
		event.preventDefault();
		updateAcceleration(1, timestamp, route.target, Math.sign(dy));
	}
}

export function resetKeyboardRuntime(): void {
	activeMediaInteraction = null;
}
