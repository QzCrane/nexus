// goal: Layout algorithm entry for HoverZoom viewer positioning
// eff: Re-exports types and provides main calculateLayout function

export type { LayoutCandidate, LayoutResult } from './layout-types';
export { LAYOUT_CONFIG } from './layout-types';
import { LayoutResult, LAYOUT_CONFIG as CONFIG } from './layout-types';
import type { ViewMode } from '../../types';
import {
	calcSize,
	evaluateSpaces,
	checkOriginalFit,
	selectBestPosition
} from './layout-calc';

/**
 * Calculate optimal layout position and size for viewer.
 * @param viewMode - 'fit' to maximize size, 'original' to keep original size
 */
export function calculateLayout(
	contentW: number,
	contentH: number,
	triggerRect: DOMRect | null,
	mouseX: number,
	mouseY: number,
	viewMode: ViewMode = 'original'
): LayoutResult {
	const vpW = window.innerWidth;
	const vpH = window.innerHeight;
	const { margin, gap } = CONFIG;

	if (!contentW || !contentH) {
		return { left: margin, top: margin, width: 200, height: 150 };
	}

	if (triggerRect) {
		return calculateLayoutWithTrigger(contentW, contentH, triggerRect, vpW, vpH, margin, gap, viewMode);
	} else {
		return calculateLayoutNearMouse(contentW, contentH, mouseX, mouseY, vpW, vpH, margin, gap, viewMode);
	}
}

/** Calculate layout when trigger element is available */
function calculateLayoutWithTrigger(
	contentW: number,
	contentH: number,
	tr: DOMRect,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number,
	viewMode: ViewMode
): LayoutResult {
	const spaces = evaluateSpaces(tr, vpW, vpH, margin, gap);
	const evaluation = checkOriginalFit(contentW, contentH, spaces);
	const best = selectBestPosition(contentW, contentH, evaluation, tr, vpW, vpH, gap, viewMode);
	const { infoBarHeight, marginBottom } = CONFIG;

	if (best) {
		return { left: best.left, top: best.top, width: best.w, height: best.h };
	}

	// Fallback: center and scale
	const maxW = vpW - margin * 2;
	const maxH = vpH - margin - marginBottom - infoBarHeight;
	const size = calcSize(contentW, contentH, maxW, maxH, viewMode);
	return {
		left: (vpW - size.w) / 2,
		top: (vpH - size.h - marginBottom - infoBarHeight + margin) / 2,
		width: size.w,
		height: size.h
	};
}

/** Calculate layout near mouse position */
function calculateLayoutNearMouse(
	contentW: number,
	contentH: number,
	mouseX: number,
	mouseY: number,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number,
	viewMode: ViewMode
): LayoutResult {
	const { infoBarHeight, marginBottom } = CONFIG;
	const maxW = vpW - margin * 2;
	const maxH = vpH - margin - marginBottom - infoBarHeight;
	const size = calcSize(contentW, contentH, maxW, maxH, viewMode);
	const finalW = size.w;
	const finalH = size.h;

	let finalLeft = mouseX + gap;
	if (finalLeft + finalW > vpW - margin) finalLeft = mouseX - finalW - gap;
	if (finalLeft < margin) finalLeft = margin;

	const finalTop = Math.max(margin, Math.min(mouseY - finalH / 2, vpH - finalH - marginBottom - infoBarHeight));

	return { left: finalLeft, top: finalTop, width: finalW, height: finalH };
}
