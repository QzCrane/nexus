// goal: Hover Zoom keyboard event handlers
// eff: Keydown/keyup logic for trigger modes

import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { cancel, ensureViewer, getElementAtMouse, tryTrigger } from './hover-zoom-events';

/**
 * Handle keydown - enable detection at current position
 * Supports both 'hold' and 'toggle' modes
 */
export function createOnKeyDown(state: HoverZoomState, preload: PreloadState) {
	return (e: KeyboardEvent) => {
		if (!state.settings.enabled) return;

		// Check if this is our trigger key
		const key = state.settings.triggerKey;
		if (key === 'none') return;
		if (key === 'shift' && !e.shiftKey) return;
		if (key === 'ctrl' && !e.ctrlKey) return;
		if (key === 'alt' && !e.altKey) return;

		// Prevent repeat events (key held down)
		if (e.repeat) return;

		state.modifiersActive = true;

		// Toggle mode: if viewer visible and locked, close it
		if (state.settings.triggerAction === 'toggle' && state.toggleLocked && state.viewer?.getIsVisible()) {
			state.toggleLocked = false;
			cancel(state);
			return;
		}

		// Try to detect at mouse position
		if (!state.mouseHasMoved) {
			// Mouse hasn't moved yet - cannot determine position
			return;
		}

		if (!state.currentTarget && !state.viewer?.getIsVisible()) {
			const el = getElementAtMouse(state);
			if (el) {
				tryTrigger(state, preload, el);
				// For toggle mode, lock the viewer open
				if (state.settings.triggerAction === 'toggle') {
					state.toggleLocked = true;
				}
			}
		}
	};
}

/**
 * Handle keyup - hide viewer when modifier released (hold mode only)
 */
export function createOnKeyUp(state: HoverZoomState) {
	return (e: KeyboardEvent) => {
		const key = state.settings.triggerKey;
		if (key === 'none') return;

		// In toggle mode, don't hide on key release
		if (state.settings.triggerAction === 'toggle') {
			return;
		}

		const shouldHide =
			(key === 'shift' && e.key === 'Shift') ||
			(key === 'ctrl' && (e.key === 'Control' || e.key === 'Meta')) ||
			(key === 'alt' && e.key === 'Alt');

		if (shouldHide) {
			state.modifiersActive = false;
			cancel(state);
		}
	};
}
