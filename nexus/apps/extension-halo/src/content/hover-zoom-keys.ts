// goal: Hover Zoom keyboard event handlers
// eff: keydown proactively checks, keyup closes immediately + clears debounce

import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/trigger-validator';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import { cancelPreview, getElementAtMouse } from './hover-zoom-actions-light';
import { clearTriggerTimer } from './hover-zoom-events';
import { cancelPendingPreviewIntent, requestPreview } from './hover-zoom-runtime-loader';

/** Find valid trigger element at or above given element */
function findTriggerElement(el: HTMLElement | null): HTMLElement | null {
	while (el && !isValidTrigger(el)) {
		el = el.parentElement;
	}
	return el && isValidTrigger(el) ? el : null;
}

/** Handle keydown - proactively check mouse position and trigger if valid */
export function createOnKeyDown(state: HoverZoomState, preload: PreloadState) {
	return (e: KeyboardEvent) => {
		if (!state.settings.enabled) return;
		if (e.repeat) return;

		// ESCAPE: Close and unlock
		if (e.key === 'Escape') {
			cancelPendingPreviewIntent();
			if (state.viewer?.getIsVisible()) {
				clearTriggerTimer();
				cancelPreview(state);
			}
			return;
		}

		// PIN KEY: Toggle pin mode (configurable, default Space)
		const pinKey = state.settings.pinKey;
		if (pinKey && e.key === pinKey && state.viewer?.getIsVisible()) {
			// Full isolation: prevent key from reaching the page
			e.preventDefault();
			e.stopImmediatePropagation();

			if (!state.viewer.isPinned()) {
				state.viewer.pin();
				state.toggleLocked = true;
			} else {
				state.viewer.unpin();
				state.toggleLocked = false;
			}
			return;
		}

		// Check if this keydown creates a valid hotkey combo
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		if (resourcePref === null) return;

		// Block mode must remain synchronous even though preview code is lazy.
		if (e.key === 'Alt' && state.settings.altKeyMode === 'block') {
			e.preventDefault();
		}

		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;

		// If mouse position unknown, can't trigger
		if (!state.mouseHasMoved) return;

		// If already visible, don't re-trigger
		if (state.viewer?.getIsVisible()) return;

		// Proactively find element at mouse position
		const el = getElementAtMouse(state);
		if (!el) return;

		const trigger = findTriggerElement(el);
		if (!trigger) return;

		// Show highlight synchronously; resolver/viewer work loads on demand.
		if (state.settings.highlightMode === 'hotkey') {
			showHighlight(trigger);
		}
		void requestPreview(state, preload, trigger);
	};
}

/** Handle keyup - close viewer immediately when modifiers released */
export function createOnKeyUp(state: HoverZoomState) {
	return (e: KeyboardEvent) => {
		if (!state.settings.enabled) return;
		if (state.toggleLocked) return;

		// Only care about modifier releases
		const modifierKeys = ['Shift', 'Control', 'Meta', 'Alt'];
		if (!modifierKeys.includes(e.key)) return;

		// Prevent browser menu based on altKeyMode setting
		if (e.key === 'Alt') {
			const wasVisible = state.viewer?.getIsVisible() ?? false;
			// block mode: always prevent, compat mode: only when viewer visible
			if (state.settings.altKeyMode === 'block' || wasVisible) {
				e.preventDefault();
			}
		}

		// Check if any valid combo still exists
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);

		if (resourcePref === null) {
			// No valid combo - retire both pending lazy work and an active viewer.
			cancelPendingPreviewIntent();
			clearTriggerTimer();
			state.modifiersActive = false;
			state.currentResourcePref = 'auto';
			hideHighlight();
			cancelPreview(state);
		} else {
			// Still valid combo - just update preference
			state.currentResourcePref = resourcePref;
		}
	};
}
