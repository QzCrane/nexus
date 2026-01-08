
import { LAYOUT_CONFIG } from './layout-types';
import type { ViewMode } from '../../types';

/**
 * Calculate best size for given max dimensions, respecting aspect ratio.
 * IMPORTANT: Always maintains aspect ratio (equal scaling) - never distort!
 * 
 * Modes:
 * - 'fit': Scale to fill available space (can scale up or down)
 * - 'original': Keep original size, clamp to max if larger (default)
 */
export function calcSize(
	contentW: number, contentH: number,
	maxW: number, maxH: number,
	mode: ViewMode = 'original'
): { w: number; h: number } {
	if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };

	if (mode === 'fit') {
		// Fit mode: scale to fill available space (can scale up or down)
		const scale = Math.min(maxW / contentW, maxH / contentH);
		return { w: contentW * scale, h: contentH * scale };
	}

	// Original mode (default): keep original size, clamp to fit if larger
	const w = Math.min(contentW, maxW);
	const h = Math.min(contentH, maxH);
	// If either dimension was clamped, scale both to maintain aspect ratio
	if (w < contentW || h < contentH) {
		const scale = Math.min(w / contentW, h / contentH);
		return { w: contentW * scale, h: contentH * scale };
	}
	return { w: contentW, h: contentH };
}

/**
 * Calculate vertical position ensuring trigger's vertical range is covered by viewer.
 * Viewer must satisfy: viewerTop <= tr.top && viewerTop + viewerH >= tr.bottom
 */
export function calcVerticalPos(viewerH: number, tr: DOMRect, vpH: number): number {
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
export function calcHorizontalPos(viewerW: number, tr: DOMRect, vpW: number): number {
	const { margin } = LAYOUT_CONFIG;
	const minLeft = Math.max(margin, tr.right - viewerW);
	const maxLeft = Math.min(vpW - viewerW - margin, tr.left);

	if (minLeft > maxLeft) {
		return Math.max(margin, Math.min(tr.left + (tr.width - viewerW) / 2, vpW - viewerW - margin));
	}
	const centered = tr.left + (tr.width - viewerW) / 2;
	return Math.max(minLeft, Math.min(centered, maxLeft));
}
