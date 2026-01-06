// goal: Layout algorithm entry for HoverZoom viewer positioning
// eff: Re-exports types and provides main calculateLayout function

export type { LayoutCandidate, LayoutResult } from './layout-types';
import { LayoutResult, LAYOUT_CONFIG } from './layout-types';
import {
	calcSize,
	evaluateSpaces,
	checkOriginalFit,
	selectBestPosition
} from './layout-calc';

/**
 * Calculate optimal layout position and size for viewer.
 * New algorithm with 4 steps:
 * 1. Evaluate all 4 directions → calculate available space
 * 2. Check if original image can fit without scaling
 * 3. Select best position (original size preferred, otherwise largest scaled area)
 * 4. Apply layout
 *
 * @param contentW - Original content width
 * @param contentH - Original content height
 * @param triggerRect - Trigger element bounding rect (optional)
 * @param mouseX - Mouse X position (fallback when no trigger)
 * @param mouseY - Mouse Y position (fallback when no trigger)
 * @returns Layout result with final position and dimensions
 */
export function calculateLayout(
	contentW: number,
	contentH: number,
	triggerRect: DOMRect | null,
	mouseX: number,
	mouseY: number
): LayoutResult {
	const vpW = window.innerWidth;
	const vpH = window.innerHeight;
	const { margin, gap } = LAYOUT_CONFIG;

	// Fallback when no content dimensions
	if (!contentW || !contentH) {
		return { left: margin, top: margin, width: 200, height: 150 };
	}

	if (triggerRect) {
		return calculateLayoutWithTrigger(contentW, contentH, triggerRect, vpW, vpH, margin, gap);
	} else {
		return calculateLayoutNearMouse(contentW, contentH, mouseX, mouseY, vpW, vpH, margin, gap);
	}
}

/**
 * STEP 4: Apply layout - Calculate layout when trigger element is available.
 * Uses the 4-step algorithm: evaluate → check → select → apply
 */
function calculateLayoutWithTrigger(
	contentW: number,
	contentH: number,
	tr: DOMRect,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number
): LayoutResult {
	// STEP 1: Evaluate available spaces in all directions
	const spaces = evaluateSpaces(tr, vpW, vpH, margin, gap);

	// STEP 2: Check if original image can fit
	const evaluation = checkOriginalFit(contentW, contentH, spaces);

	// STEP 3: Select best position
	const best = selectBestPosition(contentW, contentH, evaluation, tr, vpW, vpH, gap);
	const { infoBarHeight, marginBottom } = LAYOUT_CONFIG;

	// STEP 4: Apply layout - height is just the content, info bar is outside
	if (best) {
		return { left: best.left, top: best.top, width: best.w, height: best.h };
	}

	// Fallback: no valid direction, center and scale down
	const maxW = vpW - margin * 2;
	const maxH = vpH - margin - marginBottom - infoBarHeight;
	const scale = Math.min(maxW / contentW, maxH / contentH, 1);
	const finalW = contentW * scale;
	const finalH = contentH * scale;
	return {
		left: (vpW - finalW) / 2,
		top: (vpH - finalH - marginBottom - infoBarHeight + margin) / 2,
		width: finalW,
		height: finalH
	};
}

/**
 * Calculate layout when no trigger element (position near mouse).
 */
function calculateLayoutNearMouse(
	contentW: number,
	contentH: number,
	mouseX: number,
	mouseY: number,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number
): LayoutResult {
	const { infoBarHeight, marginBottom } = LAYOUT_CONFIG;
	const maxW = vpW - margin * 2;
	const maxH = vpH - margin - marginBottom - infoBarHeight;
	const size = calcSize(contentW, contentH, maxW, maxH);
	const finalW = size.w;
	const finalH = size.h;

	let finalLeft = mouseX + gap;
	if (finalLeft + finalW > vpW - margin) finalLeft = mouseX - finalW - gap;
	if (finalLeft < margin) finalLeft = margin;

	const finalTop = Math.max(margin, Math.min(mouseY - finalH / 2, vpH - finalH - marginBottom - infoBarHeight));

	return { left: finalLeft, top: finalTop, width: finalW, height: finalH };
}
