import type { HoverZoomSettings } from '../tools/hover-zoom/types';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/trigger-validator';
import { resolveEnhanced, detectQuick, needsAsyncResolve } from '../tools/hover-zoom/content/resolvers/rule-resolver';
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
	// If viewer is visible and blocking (pointer-events: auto), use elementsFromPoint to look through it
	if (state.viewer?.getIsVisible()) {
		const elements = document.elementsFromPoint(state.lastX, state.lastY);
		for (const pointEl of elements) {
			const el = pointEl as HTMLElement;
			// Skip the viewer container and its children
			if (!el.closest('#halo-hover-zoom-container')) {
				return el;
			}
		}
	}

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
	if (state.viewer) {
		state.viewer.hide();
	}
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
		// CRITICAL: Check if conditions still valid before showing
		if (!state.modifiersActive) return;  // Hotkeys released
		if (state.currentTarget !== target) return;  // Target changed

		try {
			// Check cache first (must match current pref)
			if (cacheValid && cached) {
				const v = ensureViewer(state);
				v.show(cached.result, state.lastX, state.lastY);
				return;
			}

			const result = await resolveEnhanced(target, capturedPref);
			// Recheck after await
			if (!result || !state.modifiersActive || state.currentTarget !== target) return;

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

	// Skip if already showing this target
	if (state.viewer?.getIsVisible() && state.currentTarget === target) {
		return;
	}

	// Show highlight based on mode setting
	if (state.settings.highlightMode === 'hotkey') {
		showHighlight(target);
	}

	const currentPref = state.currentResourcePref;

	// Check cache (must match current pref)
	const cached = preload.cache.get(target);
	if (cached && cached.pref === currentPref) {
		clearTimer(state);  // Cancel any pending timer
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
	} else if (needsAsyncResolve(target)) {
		state.currentTarget = target;
		startTimer(state, preload, target);
	}
}
