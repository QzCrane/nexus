
import {
	AvailableSpace,
	SpaceEvaluation,
	LAYOUT_CONFIG
} from './layout-types';

/**
 * STEP 1: Evaluate available space in all four directions
 * Returns array of available spaces with their dimensions
 * Note: maxHeight accounts for info bar height at bottom
 * Note: Widths/heights account for viewer border width
 */
export function evaluateSpaces(
	tr: DOMRect,
	vpW: number,
	vpH: number,
	margin: number,
	gap: number
): AvailableSpace[] {
	const spaces: AvailableSpace[] = [];
	const { infoBarHeight, marginBottom, borderWidth } = LAYOUT_CONFIG;
	const border2 = borderWidth * 2;  // Both sides

	// For horizontal placement: height is viewport minus margins, info bar, and borders
	const availH_horizontal = vpH - margin - marginBottom - infoBarHeight - border2;
	// For vertical placement: width is full viewport minus left/right margins and borders
	const availW_vertical = vpW - margin * 2 - border2;

	// RIGHT: space to the right of trigger (minus border)
	const spaceRight = vpW - tr.right - margin - gap - border2;
	if (spaceRight > 0) {
		spaces.push({
			dir: 'right',
			maxWidth: spaceRight,
			maxHeight: availH_horizontal,
			spaceSize: spaceRight
		});
	}

	// LEFT: space to the left of trigger (minus border)
	const spaceLeft = tr.left - margin - gap - border2;
	if (spaceLeft > 0) {
		spaces.push({
			dir: 'left',
			maxWidth: spaceLeft,
			maxHeight: availH_horizontal,
			spaceSize: spaceLeft
		});
	}

	// BOTTOM: space below trigger (minus border)
	const spaceBottom = vpH - tr.bottom - margin - gap - border2;
	if (spaceBottom > 0) {
		spaces.push({
			dir: 'bottom',
			maxWidth: availW_vertical,
			maxHeight: spaceBottom,
			spaceSize: spaceBottom
		});
	}

	// TOP: space above trigger (minus border)
	const spaceTop = tr.top - margin - gap - border2;
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
