// goal: Hover Zoom event handlers
// eff: All mouse and keyboard event logic

import type { HoverZoomSettings } from '../tools/hover-zoom/types';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/image-resolver';
import { resolveEnhanced, detectQuick } from '../tools/hover-zoom/content/resolvers/rule-resolver';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer/index';
import { HotkeyManager } from '../tools/hover-zoom/content/utils/hotkeys';

/**
 * Ensure viewer instance exists
 */
export function ensureViewer(state: HoverZoomState): HoverZoomViewer {
	if (!state.viewer) {
		state.viewer = new HoverZoomViewer(state.settings);
		state.hotkeys = new HotkeyManager(state.settings, state.viewer);
	}
	return state.viewer;
}

/**
 * Get element at current mouse position
 */
export function getElementAtMouse(state: HoverZoomState): HTMLElement | null {
	const el = document.elementFromPoint(state.lastX, state.lastY);
	return el as HTMLElement | null;
}

/**
 * Check if mouse is over viewer container
 */
export function isOverViewer(state: HoverZoomState): boolean {
	const viewerEl = document.getElementById('halo-hover-zoom-container');
	if (!viewerEl) return false;
	const rect = viewerEl.querySelector('.halo-hz-viewer')?.getBoundingClientRect();
	if (!rect) return false;
	return state.lastX >= rect.left && state.lastX <= rect.right &&
		state.lastY >= rect.top && state.lastY <= rect.bottom;
}

/**
 * Preload image URL to warm up browser cache
 */
export function preloadUrl(preload: PreloadState, url: string) {
	if (!url || url.startsWith('data:')) return;
	if (!preload.preloadImage) preload.preloadImage = new Image();
	preload.preloadImage.src = url;
}

/**
 * Clear hover timer
 */
export function clearTimer(state: HoverZoomState) {
	if (state.hoverTimer) {
		clearTimeout(state.hoverTimer);
		state.hoverTimer = null;
	}
}

/**
 * Cancel current hover and hide viewer
 */
export function cancel(state: HoverZoomState) {
	clearTimer(state);
	state.viewer?.hide();
	state.currentTarget = null;
	state.toggleLocked = false;
}

/**
 * Start timer to show viewer
 */
export function startTimer(
	state: HoverZoomState,
	preload: PreloadState,
	target: HTMLElement
) {
	clearTimer(state);

	// Reduced delay for cached results
	const delay = preload.cache.has(target) ? 0 : state.settings.triggerDelay;

	state.hoverTimer = window.setTimeout(async () => {
		if (state.currentTarget !== target) return;

		try {
			// Check cache first
			const cached = preload.cache.get(target);
			if (cached) {
				const v = ensureViewer(state);
				v.show(cached.result, state.lastX, state.lastY);
				return;
			}

			const result = await resolveEnhanced(target, state.currentResourcePref);
			if (!result || state.currentTarget !== target) return;

			// Cache for future use
			preload.cache.set(target, { result, url: result.url });

			const v = ensureViewer(state);
			v.show(result, state.lastX, state.lastY);
		} catch (e) {
			console.warn('[HALO:HoverZoom]', 'Resolution error:', e);
		}
	}, delay);
}

/**
 * Try to trigger on element at current position
 */
export async function tryTrigger(
	state: HoverZoomState,
	preload: PreloadState,
	target: HTMLElement
) {
	if (!isValidTrigger(target)) return;

	const cached = preload.cache.get(target);
	if (cached) {
		state.currentTarget = target;
		const v = ensureViewer(state);
		v.show(cached.result, state.lastX, state.lastY);
		return;
	}

	const quickSrc = detectQuick(target, state.settings);
	if (quickSrc) {
		state.currentTarget = target;
		preloadUrl(preload, quickSrc.url);
		startTimer(state, preload, target);
	}
}

/**
 * Handle mouseover event
 */
export function createOnOver(state: HoverZoomState, preload: PreloadState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled) return;
		state.lastX = e.clientX;
		state.lastY = e.clientY;

		const t = e.target as HTMLElement;

		// Ignore events on the viewer itself
		if (t.closest('#halo-hover-zoom-container')) return;

		// Detect resource preference based on modifier keys
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		if (resourcePref === null) {
			state.modifiersActive = false;
			return;
		}
		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;

		if (t === state.currentTarget) return;

		// Check if moving within same container
		if (state.currentTarget) {
			const currentContainer = state.currentTarget.closest('a, [data-target-url], .bili-video-card');
			const newContainer = t.closest('a, [data-target-url], .bili-video-card');
			if (currentContainer && currentContainer === newContainer) {
				return;
			}
			cancel(state);
		}

		tryTrigger(state, preload, t);

		// Preload next likely target
		if (preload.pending !== t && isValidTrigger(t)) {
			preload.pending = t;
			queueMicrotask(async () => {
				if (preload.pending !== t) return;
				const result = await resolveEnhanced(t, state.currentResourcePref);
				if (result && preload.pending === t) {
					preload.cache.set(t, { result, url: result.url });
					preloadUrl(preload, result.url);
				}
			});
		}
	};
}

/**
 * Handle mouseout event
 */
export function createOnOut(state: HoverZoomState) {
	return (e: MouseEvent) => {
		const relatedTarget = e.relatedTarget as HTMLElement;

		// If moving to viewer, keep visible
		if (relatedTarget?.closest('#halo-hover-zoom-container')) return;

		// If moving within the same trigger container, ignore
		if (state.currentTarget && relatedTarget) {
			if (state.currentTarget.contains(relatedTarget) || relatedTarget.contains(state.currentTarget)) {
				return;
			}
			const currentContainer = state.currentTarget.closest('a, [data-target-url], .bili-video-card');
			const relatedContainer = relatedTarget.closest('a, [data-target-url], .bili-video-card');
			if (currentContainer && currentContainer === relatedContainer) {
				return;
			}
		}

		// If leaving current target, hide
		if (e.target === state.currentTarget || state.currentTarget?.contains(e.target as Node)) {
			cancel(state);
		}
	};
}

/**
 * Handle mousemove event
 */
export function createOnMove(state: HoverZoomState) {
	return (e: MouseEvent) => {
		state.lastX = e.clientX;
		state.lastY = e.clientY;
		state.mouseHasMoved = true;

		// If viewer visible, check if we should hide
		if (state.viewer?.getIsVisible()) {
			if (isOverViewer(state)) return;

			if (state.currentTarget) {
				const rect = state.currentTarget.getBoundingClientRect();
				const overTarget = state.lastX >= rect.left && state.lastX <= rect.right &&
					state.lastY >= rect.top && state.lastY <= rect.bottom;
				if (!overTarget) {
					cancel(state);
				}
			}
		}
	};
}

/**
 * Handle click event
 */
export function createOnClick(state: HoverZoomState) {
	return () => {
		if (state.viewer?.getIsVisible()) {
			cancel(state);
		}
	};
}
