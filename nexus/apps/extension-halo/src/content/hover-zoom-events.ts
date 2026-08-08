// goal: Hover Zoom event handlers
// eff: Debounced trigger, no flicker, keydown proactive check

import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/trigger-validator';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';
import { cancelPreview, getElementAtMouse } from './hover-zoom-actions-light';
import {
	cancelPendingPreviewIntent,
	isPendingPreviewTransition,
	requestPreview,
} from './hover-zoom-runtime-loader';

export {
	cancelPreview as cancel,
	clearHoverTimer as clearTimer,
	getElementAtMouse,
	isOverViewer,
} from './hover-zoom-actions-light';

// Debounce timer for trigger (prevents flicker)
let triggerTimer: ReturnType<typeof setTimeout> | null = null;
const TRIGGER_DELAY = 50;

/** Clear the debounce trigger timer */
export function clearTriggerTimer() {
	if (triggerTimer) {
		clearTimeout(triggerTimer);
		triggerTimer = null;
	}
}

/** Find valid trigger element at or above given element */
function findTriggerElement(el: HTMLElement | null): HTMLElement | null {
	while (el && !isValidTrigger(el)) {
		el = el.parentElement;
	}
	return el && isValidTrigger(el) ? el : null;
}

/** Core display logic */
function evaluateAndTrigger(
	state: HoverZoomState, preload: PreloadState,
	target: HTMLElement | null, hotkeysActive: boolean
) {
	// Double check - if modifiers were released via keyup, don't show.
	if (!state.modifiersActive && !hotkeysActive) {
		cancelPendingPreviewIntent();
		const isVisible = state.viewer?.getIsVisible() ?? false;
		if (isVisible && !state.toggleLocked) cancelPreview(state);
		hideHighlight();
		return;
	}

	const validTarget = target ? findTriggerElement(target) : null;
	const shouldShow = hotkeysActive && validTarget !== null;
	const isVisible = state.viewer?.getIsVisible() ?? false;

	if (shouldShow && validTarget) {
		state.modifiersActive = true;
		if (state.settings.highlightMode === 'hotkey') showHighlight(validTarget);

		// Skip if the loaded runtime already owns this target.
		if (state.currentTarget === validTarget) {
			return;
		}

		if (isVisible) {
			cancelPreview(state);
		}
		void requestPreview(state, preload, validTarget);
	} else {
		cancelPendingPreviewIntent();
		if (isVisible && !state.toggleLocked) cancelPreview(state);
		state.modifiersActive = false;
		hideHighlight();
	}
}

/** Handle mouseover - only for highlight in 'always' mode */
export function createOnOver(state: HoverZoomState, _preload: PreloadState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled) return;
		state.lastX = e.clientX;
		state.lastY = e.clientY;

		const t = e.target as HTMLElement;
		if (t.closest('#halo-hover-zoom-container')) return;

		if (state.settings.highlightMode === 'always') {
			const trigger = findTriggerElement(t);
			trigger ? showHighlight(trigger) : hideHighlight();
		}
	};
}

/** Handle mouseout - cancel only after the pointer leaves the logical trigger. */
export function createOnOut(state: HoverZoomState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled || state.toggleLocked) return;

		const related = e.relatedTarget as HTMLElement | null;
		if (related?.closest('#halo-hover-zoom-container')) return;

		// A lazy import can still be in flight before currentTarget is claimed.
		// Preserve it across descendant/ancestor transitions of the same pending
		// target without re-running trigger validation on this hot event.
		if (isPendingPreviewTransition(related)) return;

		if (state.currentTarget) {
			if (related && state.currentTarget.contains(related)) return;
			if (related?.contains(state.currentTarget)) return;
		}

		clearTriggerTimer();
		cancelPendingPreviewIntent();
		if (state.currentTarget) cancelPreview(state);
		else hideHighlight();
	};
}

/** Handle mousemove - debounced trigger check */
// eff: cached callback to avoid closure allocation on every move
export function createOnMove(state: HoverZoomState, preload: PreloadState) {
	let _hotkeysActive = false;
	const checkTrigger = () => {
		triggerTimer = null;
		const el = getElementAtMouse(state);
		evaluateAndTrigger(state, preload, el, _hotkeysActive);
	};

	return (e: MouseEvent) => {
		state.lastX = e.clientX;
		state.lastY = e.clientY;
		state.mouseHasMoved = true;

		if (!state.settings.enabled) {
			cancelPendingPreviewIntent();
			if (state.viewer?.getIsVisible()) cancelPreview(state);
			return;
		}

		if (state.toggleLocked && state.viewer?.getIsVisible()) return;

		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		const hotkeysActive = resourcePref !== null;

		if (resourcePref !== null) state.currentResourcePref = resourcePref;
		else cancelPendingPreviewIntent();

		clearTriggerTimer();

		// If viewer visible but hotkeys not active -> cancel immediately
		if (state.viewer?.getIsVisible() && !hotkeysActive && !state.toggleLocked) {
			cancelPreview(state);
			state.modifiersActive = false;
			hideHighlight();
			return;
		}

		// Debounced evaluation
		_hotkeysActive = hotkeysActive;
		triggerTimer = setTimeout(checkTrigger, TRIGGER_DELAY);
	};
}

/** Handle click - close viewer */
export function createOnClick(state: HoverZoomState) {
	return () => {
		if (!state.settings.enabled || state.toggleLocked) return;
		if (state.viewer?.getIsVisible()) {
			cancelPendingPreviewIntent();
			clearTriggerTimer();
			cancelPreview(state);
		}
	};
}
