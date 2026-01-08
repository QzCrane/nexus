import { ViewerDOM } from '../viewer-dom';
import { HoverZoomSettings, ViewMode } from '../../types';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { calculateLayout } from './layout';
import { updateInfoBar } from './info';
import { isDashSegment, isPlayableVideoUrl, findThumbnailUrl } from './media-loader';

const LOG_TAG = '[HALO:HoverZoom:MediaDisplay]';

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

		applyLayout(dom, triggerRect, currentType, mouseX, mouseY, preloadImg.naturalWidth, preloadImg.naturalHeight, settings.viewMode);
		dom.viewer.classList.add('visible');
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

export function showVideo(
	dom: ViewerDOM,
	settings: HoverZoomSettings,
	source: EnhancedResult,
	mouseX: number,
	mouseY: number,
	triggerRect: DOMRect | null,
	currentType: string,
	isVisible: () => boolean,
	onLoaded: () => void,
	onError: () => void,
	fallback: (source: EnhancedResult, mouseX: number, mouseY: number) => void
): void {
	if (!dom) return;

	console.log(LOG_TAG, 'Loading video:', source.url.slice(0, 100));

	// Check if URL is DASH segment - cannot play directly
	if (isDashSegment(source.url)) {
		console.warn(LOG_TAG, 'DASH m4s stream detected, falling back to thumbnail');
		fallback(source, mouseX, mouseY);
		return;
	}

	// Check if URL looks like a playable video format
	if (!isPlayableVideoUrl(source.url)) {
		console.warn(LOG_TAG, 'Unrecognized video URL format, falling back to thumbnail');
		fallback(source, mouseX, mouseY);
		return;
	}

	dom.video.style.display = 'block';
	dom.video.src = source.url;
	dom.video.muted = true;

	dom.video.onloadedmetadata = () => {
		console.log(LOG_TAG, 'Video loaded', dom?.video.videoWidth, dom?.video.videoHeight);
		if (!isVisible() || !dom) return;

		onLoaded();
		applyLayout(dom, triggerRect, currentType, mouseX, mouseY, dom.video.videoWidth, dom.video.videoHeight, settings.viewMode);
		dom.viewer.classList.add('visible');
		updateInfoBar(dom, settings, source, 'video', dom.video, dom.video.videoWidth, dom.video.videoHeight);
	};

	dom.video.onerror = (e) => {
		console.error(LOG_TAG, 'Video load error:', source.url.slice(0, 100), e);
		onError();
		fallback(source, mouseX, mouseY);
	};

	dom.video.play().catch(() => { });
}

export function fallbackToThumbnail(
	dom: ViewerDOM,
	source: EnhancedResult,
	mouseX: number,
	mouseY: number,
	triggerRect: DOMRect | null,
	isVisible: () => boolean,
	onLoaded: () => void,
	onError: () => void,
	setCurrentType: (type: 'image' | 'video') => void
): void {
	if (dom) {
		dom.video.style.display = 'none';
		dom.video.src = '';
	}

	const thumbUrl = findThumbnailUrl(source.element);
	if (thumbUrl) {
		console.log(LOG_TAG, 'Using thumbnail fallback:', thumbUrl.slice(0, 80));
		setCurrentType('image');
		showImage(dom, {} as any, { ...source, type: 'image', url: thumbUrl }, mouseX, mouseY, triggerRect, 'image', isVisible, onLoaded, onError);
	} else {
		console.warn(LOG_TAG, 'No thumbnail fallback available');
		onError();
	}
}


function applyLayout(dom: ViewerDOM, triggerRect: DOMRect | null, currentType: string, mouseX: number, mouseY: number, contentW: number, contentH: number, viewMode: ViewMode = 'original') {
	if (!dom || !contentW || !contentH) return;

	const layout = calculateLayout(contentW, contentH, triggerRect, mouseX, mouseY, viewMode);

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
