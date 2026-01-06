// goal: Hover Zoom event handlers
// eff: All mouse and keyboard event logic

import type { HoverZoomSettings } from '../tools/hover-zoom/types';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/image-resolver';
import { resolveEnhanced, detectQuick } from '../tools/hover-zoom/content/resolvers/rule-resolver';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
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
	hideHighlight();
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

	// Capture current pref to use in async callback
	const capturedPref = state.currentResourcePref;

	// Reduced delay for cached results (only if pref matches)
	const cached = preload.cache.get(target);
	const cacheValid = cached && cached.pref === capturedPref;
	const delay = cacheValid ? 0 : state.settings.triggerDelay;

	state.hoverTimer = window.setTimeout(async () => {
		if (state.currentTarget !== target) return;

		try {
			// Check cache first (must match current pref)
			if (cacheValid && cached) {
				const v = ensureViewer(state);
				v.show(cached.result, state.lastX, state.lastY);
				return;
			}

			const result = await resolveEnhanced(target, capturedPref);
			if (!result || state.currentTarget !== target) return;

			// Cache for future use with pref
			preload.cache.set(target, { result, url: result.url, pref: capturedPref });

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

	// Show highlight on valid trigger element
	showHighlight(target);

	const currentPref = state.currentResourcePref;

	// Check cache (must match current pref)
	const cached = preload.cache.get(target);
	if (cached && cached.pref === currentPref) {
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
 * Uses direct element comparison, no container detection to avoid false triggers
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
			// No valid key combo pressed - reset state and do not trigger
			state.modifiersActive = false;
			state.currentResourcePref = 'auto';
			return;
		}
		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;

		// Same target - no action needed
		if (t === state.currentTarget) return;

		// If we have a current target, cancel it before switching
		if (state.currentTarget) {
			cancel(state);
		}

		// Try to trigger on new target
		tryTrigger(state, preload, t);
	};
}

/**
 * Handle mouseout event
 * Simplified: only cancel when truly leaving the trigger element
 */
export function createOnOut(state: HoverZoomState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled) return;

		const relatedTarget = e.relatedTarget as HTMLElement | null;

		// If moving to viewer, keep visible
		if (relatedTarget?.closest('#halo-hover-zoom-container')) return;

		// Only cancel if leaving the current target element
		if (state.currentTarget) {
			// Check if still inside current target (moved to child element)
			if (relatedTarget && state.currentTarget.contains(relatedTarget)) {
				return;
			}
			// Check if relatedTarget contains currentTarget (moved to parent)
			if (relatedTarget && relatedTarget.contains(state.currentTarget)) {
				return;
			}
			// Truly leaving - cancel
			cancel(state);
		}
	};
}

/**
 * Handle mousemove event
 * Also checks modifier state changes to close viewer when keys released
 */
export function createOnMove(state: HoverZoomState, preload: PreloadState) {
	return (e: MouseEvent) => {
		state.lastX = e.clientX;
		state.lastY = e.clientY;
		state.mouseHasMoved = true;

		// Skip all processing if disabled
		if (!state.settings.enabled) {
			// Still close any visible viewer when disabled
			if (state.viewer?.getIsVisible()) cancel(state);
			return;
		}

		// Always check modifier state on move
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);

		// If viewer visible, check if we should hide or switch
		if (state.viewer?.getIsVisible()) {
			// No valid combo pressed - close immediately
			if (resourcePref === null) {
				cancel(state);
				return;
			}

			// Preference changed - need to re-resolve and switch
			if (resourcePref !== state.currentResourcePref) {
				state.currentResourcePref = resourcePref;
				// Re-trigger on same target with new pref
				if (state.currentTarget) {
					cancel(state);
					tryTrigger(state, preload, state.currentTarget);
				}
				return;
			}

			// Same preference - check if still over target/viewer
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
		if (!state.settings.enabled) return;
		if (state.viewer?.getIsVisible()) {
			cancel(state);
		}
	};
}
