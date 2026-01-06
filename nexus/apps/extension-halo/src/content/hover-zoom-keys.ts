// goal: Hover Zoom keyboard event handlers
// eff: Keydown/keyup logic for trigger modes using resourceKeys system

import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { cancel, getElementAtMouse, tryTrigger } from './hover-zoom-events';

/**
 * Handle keydown - enable detection at current position.
 * Uses resourceKeys system to detect modifier combos (Alt, Alt+Ctrl, etc.)
 * 
 * Special keys:
 * - Space: Lock/unlock viewer (allows mouse to move away)
 * - Escape: Close viewer and unlock
 */
export function createOnKeyDown(state: HoverZoomState, preload: PreloadState) {
	return (e: KeyboardEvent) => {
		if (!state.settings.enabled) return;

		// Prevent repeat events (key held down)
		if (e.repeat) return;

		// ESCAPE: Always close and unlock
		if (e.key === 'Escape') {
			if (state.viewer?.getIsVisible()) {
				cancel(state);
			}
			return;
		}

		// SPACE: Toggle lock state (only when viewer visible)
		if (e.key === ' ' && state.viewer?.getIsVisible()) {
			e.preventDefault(); // Prevent page scroll
			state.toggleLocked = !state.toggleLocked;
			console.log('[HALO:HoverZoom]', state.toggleLocked ? 'Locked (press Space again to unlock)' : 'Unlocked');
			return;
		}

		// Detect resource preference based on current modifier state
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		if (resourcePref === null) {
			// No valid key combo pressed - don't trigger
			return;
		}

		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;

		// Try to detect at mouse position
		if (!state.mouseHasMoved) {
			// Mouse hasn't moved yet - cannot determine position
			return;
		}

		if (!state.currentTarget && !state.viewer?.getIsVisible()) {
			const el = getElementAtMouse(state);
			if (el) {
				tryTrigger(state, preload, el);
			}
		}
	};
}

/**
 * Handle keyup - hide viewer when modifier released (unless locked).
 * Detects when all required modifiers are released.
 */
export function createOnKeyUp(state: HoverZoomState) {
	return (e: KeyboardEvent) => {
		if (!state.settings.enabled) return;

		// If LOCKED, don't close on modifier release
		if (state.toggleLocked) {
			return;
		}

		// Check if the released key was a modifier
		const isModifierRelease = ['Shift', 'Control', 'Meta', 'Alt'].includes(e.key);
		if (!isModifierRelease) return;

		// Check if any valid combo still matches after key release
		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		if (resourcePref === null) {
			// No valid combo matches anymore - hide viewer
			state.modifiersActive = false;
			state.currentResourcePref = 'auto';
			cancel(state);
		} else {
			// Still have a valid combo - update preference (seamless switching)
			state.currentResourcePref = resourcePref;
		}
	};
}

