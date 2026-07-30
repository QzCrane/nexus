
// goal: Image display logic for Hover Zoom
// eff: Handles image loading, display, and layout application

import type { ViewerDOM } from '../viewer-dom';
import type { HoverZoomSettings } from '../../types';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { updateInfoBar } from './info';
import { applyLayout } from './display-layout';

const LOG_TAG = '[HALO:HoverZoom:ImageDisplay]';

/**
 * Fetch file size via blob download (works for cross-origin images)
 * Returns 0 if failed
 */
async function fetchFileSize(url: string): Promise<number> {
	try {
		const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
		if (!res.ok) return 0;
		const blob = await res.blob();
		return blob.size;
	} catch {
		return 0;
	}
}

export function showImage(
	dom: ViewerDOM,
	settings: HoverZoomSettings,
	source: EnhancedResult,
	mouseX: number,
	mouseY: number,
	triggerRect: DOMRect | null,
	currentType: string,
	isVisible: () => boolean,
	onLoaded: () => void,
	onError: () => void
): void {
	if (!dom) return;

	console.log(LOG_TAG, 'Loading image:', source.url.slice(0, 100));

	const preloadImg = new Image();
	preloadImg.referrerPolicy = 'no-referrer';

	preloadImg.onload = () => {
		console.log(LOG_TAG, 'Image loaded', preloadImg.naturalWidth, preloadImg.naturalHeight);
		if (!isVisible() || !dom) return;

		onLoaded();
		dom.img.style.display = 'block';
		dom.img.src = source.url;
		dom.img.style.opacity = '1';

		applyLayout(dom, triggerRect, currentType, mouseX, mouseY, preloadImg.naturalWidth, preloadImg.naturalHeight, settings.viewMode, settings.borderRadius);
		dom.viewer.classList.add('visible');

		// Delay interactivity to prevent underlying element from receiving mouseout during fade-in
		// This hides the "flash" of the underlying video preview stopping
		setTimeout(() => {
			if (isVisible() && dom) dom.viewer.classList.add('interactive');
		}, 200);

		updateInfoBar(dom, settings, source, 'image', dom.img, preloadImg.naturalWidth, preloadImg.naturalHeight);

		// Async: Try to get file size via fetch blob (works for cross-origin)
		if (!source.fileSize) {
			fetchFileSize(source.url).then(size => {
				if (size > 0 && isVisible() && dom) {
					source.fileSize = size;
					updateInfoBar(dom, settings, source, 'image', dom.img, preloadImg.naturalWidth, preloadImg.naturalHeight);
				}
			});
		}
	};

	preloadImg.onerror = (e) => {
		console.error(LOG_TAG, 'Image load error:', source.url.slice(0, 100), e);
		onError();
	};

	preloadImg.src = source.url;
}
