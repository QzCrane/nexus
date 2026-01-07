
import {
	AvailableSpace,
	SpaceEvaluation,
	LAYOUT_CONFIG
} from './layout-types';

/**
 * STEP 1: Evaluate available space in all four directions
 * Returns array of available spaces with their dimensions
 * Note: maxHeight accounts for info bar height at bottom
 */
export function evaluateSpaces(
	tr: DOMRect,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number
): AvailableSpace[] {
	const spaces: AvailableSpace[] = [];
	const { infoBarHeight, marginBottom } = LAYOUT_CONFIG;

	// For horizontal placement: height is viewport minus top margin, bottom margin, and info bar
	const availH_horizontal = vpH - margin - marginBottom - infoBarHeight;
	// For vertical placement: width is full viewport minus left/right margins
	const availW_vertical = vpW - margin * 2;

	// RIGHT: space to the right of trigger
	const spaceRight = vpW - tr.right - margin - gap;
	if (spaceRight > 0) {
		spaces.push({
			dir: 'right',
			maxWidth: spaceRight,
			maxHeight: availH_horizontal,
			spaceSize: spaceRight
		});
	}

	// LEFT: space to the left of trigger
	const spaceLeft = tr.left - margin - gap;
	if (spaceLeft > 0) {
		spaces.push({
			dir: 'left',
			maxWidth: spaceLeft,
			maxHeight: availH_horizontal,
			spaceSize: spaceLeft
		});
	}

	// BOTTOM: space below trigger
	const spaceBottom = vpH - tr.bottom - margin - gap;
	if (spaceBottom > 0) {
		spaces.push({
			dir: 'bottom',
			maxWidth: availW_vertical,
			maxHeight: spaceBottom,
			spaceSize: spaceBottom
		});
	}

	// TOP: space above trigger
	const spaceTop = tr.top - margin - gap;
	if (spaceTop > 0) {
		spaces.push({
			dir: 'top',
			maxWidth: availW_vertical,
			maxHeight: spaceTop,
			spaceSize: spaceTop
		});
	}

	return spaces;
}

/**
 * STEP 2: Check if original image can fit in any direction without scaling
 * Returns evaluation with canFitOriginal flag and bestFitDirection
 */
export function checkOriginalFit(
	contentW: number,
	contentH: number,
	spaces: AvailableSpace[]
): SpaceEvaluation {
	let bestFitDirection: AvailableSpace | null = null;
	let maxSpaceSize = 0;

	// Check each direction to see if original can fit
	for (const space of spaces) {
		if (contentW <= space.maxWidth && contentH <= space.maxHeight) {
			// Original fits in this direction
			if (space.spaceSize > maxSpaceSize) {
				maxSpaceSize = space.spaceSize;
				bestFitDirection = space;
			}
		}
	}

	return {
		spaces,
		canFitOriginal: bestFitDirection !== null,
		bestFitDirection
	};
}
