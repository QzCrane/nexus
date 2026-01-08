// goal: Layout calculation utilities for HoverZoom
// eff: Pure functions for size/position calculations
// inv: All calculations include full viewer footprint (content + border + infoBar)

import {
	LayoutCandidate,
	LayoutResult,
	AvailableSpace,
	SpaceEvaluation,
	LAYOUT_CONFIG
} from './layout-types';
import type { ViewMode } from '../../types';

import {
	calcSize,
	calcVerticalPos,
	calcHorizontalPos
} from './layout-helpers';

import {
	evaluateSpaces,
	checkOriginalFit
} from './layout-evaluator';

const { infoBarHeight } = LAYOUT_CONFIG;

export {
	calcSize,
	calcVerticalPos,
	calcHorizontalPos,
	evaluateSpaces,
	checkOriginalFit
};

/**
 * STEP 3: Select best position based on evaluation
 * If original fits: use bestFitDirection
 * Otherwise: find direction with largest area after scaling
 */
export function selectBestPosition(
	contentW: number,
	contentH: number,
	evaluation: SpaceEvaluation,
	tr: DOMRect,
	vpW: number,
	vpH: number,
	gap: number,
	viewMode: ViewMode = 'original'
): LayoutCandidate | null {
	// Case 1: Original image fits without scaling (only in 'original' mode)
	if (viewMode === 'original' && evaluation.canFitOriginal && evaluation.bestFitDirection) {
		const space = evaluation.bestFitDirection;
		let left = 0, top = 0;

		switch (space.dir) {
			case 'right':
				left = tr.right + gap;
				top = calcVerticalPos(contentH, tr, vpH);
				break;
			case 'left':
				left = tr.left - gap - contentW;
				top = calcVerticalPos(contentH, tr, vpH);
				break;
			case 'bottom':
				left = calcHorizontalPos(contentW, tr, vpW);
				top = tr.bottom + gap;
				break;
			case 'top':
				left = calcHorizontalPos(contentW, tr, vpW);
				// Viewer bottom (content + infoBar) must not touch trigger top
				top = tr.top - gap - contentH - infoBarHeight;
				break;
		}

		return {
			dir: space.dir,
			w: contentW,
			h: contentH,
			area: contentW * contentH,
			left,
			top
		};
	}

	// Case 2: Scale to fit available space
	const candidates: LayoutCandidate[] = [];

	for (const space of evaluation.spaces) {
		const size = calcSize(contentW, contentH, space.maxWidth, space.maxHeight, viewMode);
		if (size.w > 0 && size.h > 0) {
			let left = 0, top = 0;

			switch (space.dir) {
				case 'right':
					left = tr.right + gap;
					top = calcVerticalPos(size.h, tr, vpH);
					break;
				case 'left':
					left = tr.left - gap - size.w;
					top = calcVerticalPos(size.h, tr, vpH);
					break;
				case 'bottom':
					left = calcHorizontalPos(size.w, tr, vpW);
					top = tr.bottom + gap;
					break;
				case 'top':
					left = calcHorizontalPos(size.w, tr, vpW);
					// Viewer bottom (content + infoBar) must not touch trigger top
					top = tr.top - gap - size.h - infoBarHeight;
					break;
			}

			candidates.push({
				dir: space.dir,
				w: size.w,
				h: size.h,
				area: size.w * size.h,
				left,
				top
			});
		}
	}

	// Select largest area
	if (candidates.length > 0) {
		candidates.sort((a, b) => b.area - a.area);
		return candidates[0];
	}

	return null;
}
