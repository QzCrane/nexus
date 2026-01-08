// goal: Hover Zoom keyboard event handlers
// eff: keydown proactively checks, keyup closes immediately + clears debounce

import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { cancel, getElementAtMouse, tryTrigger, clearTriggerTimer } from './hover-zoom-events';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/image-resolver';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';

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
			if (state.viewer?.getIsVisible()) {
				clearTriggerTimer();
				cancel(state);
			}
			return;
		}

		// SPACE: Toggle lock
		if (e.key === ' ' && state.viewer?.getIsVisible()) {
			e.preventDefault();
			state.toggleLocked = !state.toggleLocked;
			return;
		}

		// Check if this keydown creates a valid hotkey combo
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		if (resourcePref === null) return;

		console.log('[HALO:HoverZoom:Keys] keydown valid combo, pref:', resourcePref);

		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;

		// If mouse position unknown, can't trigger
		if (!state.mouseHasMoved) {
			console.log('[HALO:HoverZoom:Keys] keydown: mouse not moved');
			return;
		}

		// If already visible, don't re-trigger
		const isVisible = state.viewer?.getIsVisible() ?? false;
		console.log('[HALO:HoverZoom:Keys] keydown: isVisible=', isVisible, 'currentTarget=', !!state.currentTarget);
		if (isVisible) return;

		// Proactively find element at mouse position
		const el = getElementAtMouse(state);
		console.log('[HALO:HoverZoom:Keys] keydown: element at mouse:', el?.tagName);
		if (!el) return;

		const trigger = findTriggerElement(el);
		console.log('[HALO:HoverZoom:Keys] keydown: trigger:', trigger?.tagName);
		if (!trigger) return;

		// Show highlight and trigger
		if (state.settings.highlightMode === 'hotkey') {
			showHighlight(trigger);
		}
		console.log('[HALO:HoverZoom:Keys] keydown: calling tryTrigger');
		tryTrigger(state, preload, trigger);
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

		console.log('[HALO:HoverZoom:Keys] keyup:', e.key, 'isVisible=', state.viewer?.getIsVisible());

		// Prevent browser menu ONLY if viewer was actually showing
		const wasVisible = state.viewer?.getIsVisible() ?? false;
		if (wasVisible && e.key === 'Alt') {
			e.preventDefault();
		}

		// Check if any valid combo still exists
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);

		if (resourcePref === null) {
			console.log('[HALO:HoverZoom:Keys] keyup: no valid combo, closing');
			// No valid combo - clear timer and close immediately
			clearTriggerTimer();
			state.modifiersActive = false;
			state.currentResourcePref = 'auto';
			hideHighlight();
			cancel(state);
		} else {
			// Still valid combo - just update preference
			state.currentResourcePref = resourcePref;
		}
	};
}
