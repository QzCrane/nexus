// goal: Hover Zoom event handlers
// eff: All mouse and keyboard event logic

import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/image-resolver';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer/index';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';

import {
	cancel,
	tryTrigger
} from './hover-zoom-actions';

// Re-export specific helpers used by other modules
export {
	getElementAtMouse,
	isOverViewer,
	ensureViewer,
	cancel,
	tryTrigger,
	startTimer,
	clearTimer,
	preloadUrl
} from './hover-zoom-actions';


/**
 * Handle mouseover event
 * Handles highlight in 'always' mode and triggers with hotkey
 */
export function createOnOver(state: HoverZoomState, preload: PreloadState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled) return;
		state.lastX = e.clientX;
		state.lastY = e.clientY;

		const t = e.target as HTMLElement;

		// Ignore events on the viewer itself
		if (t.closest('#halo-hover-zoom-container')) return;

		// 'always' mode: show highlight on any valid trigger (no hotkey needed)
		if (state.settings.highlightMode === 'always' && isValidTrigger(t)) {
			showHighlight(t);
		} else if (state.settings.highlightMode !== 'hotkey') {
			// 'off' mode or not valid trigger in 'always' mode: hide highlight
			hideHighlight();
		}

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

		// Try to trigger on new target (also shows highlight in 'hotkey' mode)
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
 * STRICT MODE: Viewer closes unless ALL conditions met:
 * 1. Modifier keys pressed (exact match)
 * 2. Mouse INSIDE trigger element (or viewer if locked)
 * When locked: mouse can move to viewer without closing
 */
export function createOnMove(state: HoverZoomState, preload: PreloadState) {
	return (e: MouseEvent) => {
		state.lastX = e.clientX;
		state.lastY = e.clientY;
		state.mouseHasMoved = true;

		// Skip all processing if disabled
		if (!state.settings.enabled) {
			if (state.viewer?.getIsVisible()) cancel(state);
			return;
		}

		// Check modifier state
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);

		// If viewer visible, enforce strict conditions
		if (state.viewer?.getIsVisible()) {
			// LOCKED mode: only close on Esc or explicit unlock
			if (state.toggleLocked) {
				// In locked mode, still close if modifiers released
				// (optional: can remove this check for "full lock")
				return;
			}

			// STRICT mode: must have modifiers pressed
			if (resourcePref === null) {
				cancel(state);
				return;
			}

			// STRICT mode: must be over trigger element
			if (state.currentTarget) {
				const rect = state.currentTarget.getBoundingClientRect();
				const overTarget = e.clientX >= rect.left && e.clientX <= rect.right &&
					e.clientY >= rect.top && e.clientY <= rect.bottom;
				if (!overTarget) {
					// NOT over viewer - close immediately
					cancel(state);
					return;
				}
			}

			// Preference changed - need to re-resolve
			if (resourcePref !== state.currentResourcePref) {
				state.currentResourcePref = resourcePref;
				if (state.currentTarget) {
					cancel(state);
					tryTrigger(state, preload, state.currentTarget);
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
