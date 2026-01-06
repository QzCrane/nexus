// goal: Type definitions for HoverZoom layout system
// eff: Shared types used by layout calculation functions

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
export interface AvailableSpace {
	dir: 'right' | 'left' | 'bottom' | 'top';
	maxWidth: number;   // Max width in this direction
	maxHeight: number;  // Max height in this direction
	spaceSize: number;  // Space perpendicular to trigger (for prioritization)
}

/**
 * Space evaluation result
 */
export interface SpaceEvaluation {
	spaces: AvailableSpace[];
	canFitOriginal: boolean;
	bestFitDirection: AvailableSpace | null;
}

/**
 * Layout configuration constants
 */
export const LAYOUT_CONFIG = {
	margin: 15,           // Viewport margin (top, left, right)
	marginBottom: 60,     // Bottom margin - avoid site bottom bars (e.g. Bilibili)
	gap: 10,              // Gap between trigger and viewer
	infoBarHeight: 26,    // Height reserved for info bar (24px + 2px border)
	scaleUpSmall: false   // Future: allow scaling up small images to fill space
} as const;
