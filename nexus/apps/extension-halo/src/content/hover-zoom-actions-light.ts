// goal: Hover Zoom lifecycle primitives that are safe in the static input bootstrap
// inv: This module must not import preview resolvers, viewers, MSE, or hotkey runtime code.

import { hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import type { HoverZoomState } from './hover-zoom-state';

/** Resolve the page element currently underneath the remembered pointer. */
export function getElementAtMouse(state: HoverZoomState): HTMLElement | null {
	// Once a viewer exists it may cover the original target. Look through its
	// container without requiring the viewer implementation in this module.
	if (state.viewer?.getIsVisible()) {
		const elements = document.elementsFromPoint(state.lastX, state.lastY);
		for (const pointEl of elements) {
			const el = pointEl as HTMLElement;
			if (!el.closest('#halo-hover-zoom-container')) return el;
		}
	}

	return document.elementFromPoint(state.lastX, state.lastY) as HTMLElement | null;
}

/** Check whether the remembered pointer is inside an already-created viewer. */
export function isOverViewer(state: HoverZoomState): boolean {
	const viewerEl = document.getElementById('halo-hover-zoom-container');
	if (!viewerEl) return false;
	const rect = viewerEl.querySelector('.halo-hz-viewer')?.getBoundingClientRect();
	if (!rect) return false;
	return state.lastX >= rect.left && state.lastX <= rect.right &&
		state.lastY >= rect.top && state.lastY <= rect.bottom;
}

/** Clear the delayed preview owned by an already-loaded runtime. */
export function clearHoverTimer(state: HoverZoomState): void {
	if (state.hoverTimer !== null) {
		clearTimeout(state.hoverTimer);
		state.hoverTimer = null;
	}
}

/** Retire current preview state without loading any heavy runtime code. */
export function cancelPreview(state: HoverZoomState): void {
	clearHoverTimer(state);
	state.viewer?.hide();
	state.currentTarget = null;
	state.toggleLocked = false;
	hideHighlight();
}
