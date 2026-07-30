
// goal: Layout application logic for Media Display
// eff: Applies positioning, size, and animations to the viewer

import type { ViewerDOM } from '../viewer-dom';
import type { ViewMode } from '../../types';
import { calculateLayout } from './layout';

/**
 * Apply calculated layout to viewer DOM
 */
export function applyLayout(
	dom: ViewerDOM,
	triggerRect: DOMRect | null,
	currentType: string,
	mouseX: number,
	mouseY: number,
	contentW: number,
	contentH: number,
	viewMode: ViewMode = 'original',
	borderRadius: number = 0
) {
	if (!dom || !contentW || !contentH) return;

	const layout = calculateLayout(contentW, contentH, triggerRect, mouseX, mouseY, viewMode);

	// Apply border-radius CSS variable
	dom.viewer.style.setProperty('--hz-radius', `${borderRadius}px`);

	// Show container now that media is loaded
	dom.container.style.display = '';

	// Expand animation from source
	if (triggerRect && !dom.viewer.classList.contains('visible')) {
		dom.viewer.style.transition = 'none';
		Object.assign(dom.viewer.style, {
			width: `${triggerRect.width}px`,
			height: `${triggerRect.height}px`,
			top: `${triggerRect.top}px`,
			left: `${triggerRect.left}px`,
			opacity: '0'
		});
		dom.viewer.offsetHeight; // Force reflow
		dom.viewer.style.transition = 'all 0.15s cubic-bezier(0.2, 0, 0, 1)';
	}

	// Target position - content-box: width/height is content only, border is outside
	// Round to integers to avoid subpixel rendering issues
	const w = Math.round(layout.width);
	const h = Math.round(layout.height);
	Object.assign(dom.viewer.style, {
		width: `${w}px`,
		height: `${h}px`,
		top: `${Math.round(layout.top)}px`,
		left: `${Math.round(layout.left)}px`,
		opacity: '1'
	});

	// Set media to exact same size as viewer content
	const media = currentType === 'video' ? dom.video : dom.img;
	media.style.width = `${w}px`;
	media.style.height = `${h}px`;
	// Info bar width is now set by CSS: calc(100% + 4px)
}
