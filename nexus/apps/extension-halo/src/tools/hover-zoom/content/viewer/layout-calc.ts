// goal: Layout calculation utilities for HoverZoom
// eff: Pure functions for size/position calculations

import {
	LayoutCandidate,
	LayoutResult,
	AvailableSpace,
	SpaceEvaluation,
	LAYOUT_CONFIG
} from './layout-types';

import {
	calcSize,
	calcVerticalPos,
	calcHorizontalPos
} from './layout-helpers';

import {
	evaluateSpaces,
	checkOriginalFit
} from './layout-evaluator';

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
	gap: number
): LayoutCandidate | null {
	// Case 1: Original image fits without scaling
	if (evaluation.canFitOriginal && evaluation.bestFitDirection) {
		const space = evaluation.bestFitDirection;
		let left = 0, top = 0;

		// Calculate position based on direction
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
				top = tr.top - gap - contentH;
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

	// Case 2: Need to scale down (or potentially up if scaleUpSmall enabled)
	const candidates: LayoutCandidate[] = [];

	for (const space of evaluation.spaces) {
		const size = calcSize(contentW, contentH, space.maxWidth, space.maxHeight);
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
					top = tr.top - gap - size.h;
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
