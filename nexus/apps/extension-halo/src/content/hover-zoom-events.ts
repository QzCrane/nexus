// goal: Hover Zoom event handlers
// eff: Debounced trigger, no flicker, keydown proactive check

import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/image-resolver';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import type { HoverZoomState, PreloadState } from './hover-zoom-state';

import { cancel, tryTrigger, getElementAtMouse } from './hover-zoom-actions';

export {
	getElementAtMouse, isOverViewer, ensureViewer, cancel, tryTrigger, startTimer,
	clearTimer, preloadUrl
} from './hover-zoom-actions';

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
	const validTarget = target ? findTriggerElement(target) : null;
	const shouldShow = hotkeysActive && validTarget !== null;
	const isVisible = state.viewer?.getIsVisible() ?? false;

	if (shouldShow && validTarget) {
		state.modifiersActive = true;
		if (state.settings.highlightMode === 'hotkey') showHighlight(validTarget);

		// Only trigger if: not visible, or target changed
		if (!isVisible || state.currentTarget !== validTarget) {
			if (isVisible && state.currentTarget !== validTarget) cancel(state);
			tryTrigger(state, preload, validTarget);
		}
	} else {
		if (isVisible && !state.toggleLocked) cancel(state);
		state.modifiersActive = false;
		hideHighlight();
	}
}

/** Handle mouseover - only for highlight in 'always' mode */
export function createOnOver(state: HoverZoomState, preload: PreloadState) {
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

/** Handle mouseout - cancel when leaving trigger */
export function createOnOut(state: HoverZoomState) {
	return (e: MouseEvent) => {
		if (!state.settings.enabled || state.toggleLocked) return;

		const related = e.relatedTarget as HTMLElement | null;
		if (related?.closest('#halo-hover-zoom-container')) return;

		if (state.currentTarget) {
			if (related && state.currentTarget.contains(related)) return;
			if (related && related.contains(state.currentTarget)) return;
			clearTriggerTimer();
			cancel(state);
		}
	};
}

/** Handle mousemove - debounced trigger check */
export function createOnMove(state: HoverZoomState, preload: PreloadState) {
	return (e: MouseEvent) => {
		state.lastX = e.clientX;
		state.lastY = e.clientY;
		state.mouseHasMoved = true;

		if (!state.settings.enabled) {
			if (state.viewer?.getIsVisible()) cancel(state);
			return;
		}

		if (state.toggleLocked && state.viewer?.getIsVisible()) return;

		const resourcePref = detectResourcePreference(state.settings.resourceKeys, e);
		const hotkeysActive = resourcePref !== null;

		if (hotkeysActive) state.currentResourcePref = resourcePref!;

		clearTriggerTimer();

		// If viewer visible but hotkeys not active -> cancel immediately
		if (state.viewer?.getIsVisible() && !hotkeysActive && !state.toggleLocked) {
			cancel(state);
			state.modifiersActive = false;
			hideHighlight();
			return;
		}

		// Debounced evaluation
		triggerTimer = setTimeout(() => {
			triggerTimer = null;
			const el = getElementAtMouse(state);
			evaluateAndTrigger(state, preload, el, hotkeysActive);
		}, TRIGGER_DELAY);
	};
}

/** Handle click - close viewer */
export function createOnClick(state: HoverZoomState) {
	return () => {
		if (!state.settings.enabled || state.toggleLocked) return;
		if (state.viewer?.getIsVisible()) {
			clearTriggerTimer();
			cancel(state);
		}
	};
}
