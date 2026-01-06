// goal: Layout algorithm for HoverZoom viewer positioning
// eff: Calculate optimal position and size based on trigger element and viewport

/**
 * Candidate position for viewer placement
 */
export interface LayoutCandidate {
	dir: 'right' | 'left' | 'bottom' | 'top';
	w: number;
	h: number;
	area: number;
	left: number;
	top: number;
}

/**
 * Layout result with final position and dimensions
 */
export interface LayoutResult {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Available space in each direction
 */
interface AvailableSpace {
	dir: 'right' | 'left' | 'bottom' | 'top';
	maxWidth: number;   // Max width in this direction
	maxHeight: number;  // Max height in this direction
	spaceSize: number;  // Space perpendicular to trigger (for prioritization)
}

/**
 * Space evaluation result
 */
interface SpaceEvaluation {
	spaces: AvailableSpace[];
	canFitOriginal: boolean;
	bestFitDirection: AvailableSpace | null;
}

/**
 * Layout configuration constants
 */
const LAYOUT_CONFIG = {
	margin: 15,           // Viewport margin (top, left, right)
	marginBottom: 60,     // Bottom margin - avoid site bottom bars (e.g. Bilibili)
	gap: 10,              // Gap between trigger and viewer
	infoBarHeight: 26,    // Height reserved for info bar (24px + 2px border)
	scaleUpSmall: false   // Future: allow scaling up small images to fill space
} as const;

/**
 * Calculate best size for given max dimensions, respecting aspect ratio.
 * IMPORTANT: Always maintains aspect ratio (equal scaling) - never distort!
 * Never scales up beyond original size.
 */
function calcSize(contentW: number, contentH: number, maxW: number, maxH: number): { w: number; h: number } {
	if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
	// Use single scale factor for both dimensions → preserves aspect ratio
	const scale = Math.min(maxW / contentW, maxH / contentH, 1);
	return { w: contentW * scale, h: contentH * scale };
}

/**
 * Calculate vertical position ensuring trigger's vertical range is covered by viewer.
 * Viewer must satisfy: viewerTop <= tr.top && viewerTop + viewerH >= tr.bottom
 */
function calcVerticalPos(viewerH: number, tr: DOMRect, vpH: number): number {
	const { margin, marginBottom } = LAYOUT_CONFIG;
	const minTop = Math.max(margin, tr.bottom - viewerH);
	const maxTop = Math.min(vpH - viewerH - marginBottom, tr.top);

	if (minTop > maxTop) {
		// Can't satisfy constraint, center on trigger
		return Math.max(margin, Math.min(tr.top + (tr.height - viewerH) / 2, vpH - viewerH - marginBottom));
	}
	// Prefer centering on trigger within valid range
	const centered = tr.top + (tr.height - viewerH) / 2;
	return Math.max(minTop, Math.min(centered, maxTop));
}

/**
 * Calculate horizontal position ensuring trigger's horizontal range is covered by viewer.
 */
function calcHorizontalPos(viewerW: number, tr: DOMRect, vpW: number): number {
	const { margin } = LAYOUT_CONFIG;
	const minLeft = Math.max(margin, tr.right - viewerW);
	const maxLeft = Math.min(vpW - viewerW - margin, tr.left);

	if (minLeft > maxLeft) {
		return Math.max(margin, Math.min(tr.left + (tr.width - viewerW) / 2, vpW - viewerW - margin));
	}
	const centered = tr.left + (tr.width - viewerW) / 2;
	return Math.max(minLeft, Math.min(centered, maxLeft));
}

/**
 * STEP 1: Evaluate available space in all four directions
 * Returns array of available spaces with their dimensions
 * Note: maxHeight accounts for info bar height at bottom
 */
function evaluateSpaces(
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
function checkOriginalFit(
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

/**
 * STEP 3: Select best position based on evaluation
 * If original fits: use bestFitDirection
 * Otherwise: find direction with largest area after scaling
 */
function selectBestPosition(
	contentW: number,
	contentH: number,
	evaluation: SpaceEvaluation,
	tr: DOMRect,
	vpW: number,
	vpH: number,
	gap: number
): LayoutCandidate | null {
	const { scaleUpSmall } = LAYOUT_CONFIG;

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
	const scale = Math.min(maxW / contentW, maxH / contentH, 1);
	const finalW = contentW * scale;
	const finalH = contentH * scale;

	let finalLeft = mouseX + gap;
	if (finalLeft + finalW > vpW - margin) finalLeft = mouseX - finalW - gap;
	if (finalLeft < margin) finalLeft = margin;

	const finalTop = Math.max(margin, Math.min(mouseY - finalH / 2, vpH - finalH - marginBottom - infoBarHeight));

	return { left: finalLeft, top: finalTop, width: finalW, height: finalH };
}
