// goal: Enhanced floating image/video viewer (main entry)
// eff: Orchestrates layout, transform, info, and media display

import { HoverZoomSettings } from '../../types';
import { injectStyles, createViewerDOM, ViewerDOM } from '../viewer-dom';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { calculateLayout } from './layout';
import { TransformController } from './transform';
import { updateInfoBar } from './info';
import { isDashSegment, isPlayableVideoUrl, findThumbnailUrl } from './media-loader';

const LOG_TAG = '[HALO:HoverZoom:Viewer]';

/**
 * HoverZoomViewer - Main viewer class for displaying images and videos.
 * Manages lifecycle, media loading, layout positioning, and user interactions.
 */
export class HoverZoomViewer {
	private dom: ViewerDOM | null = null;
	private settings: HoverZoomSettings;
	private ready = false;
	private isVisible = false;
	private currentSource: EnhancedResult | null = null;
	private currentType: 'image' | 'video' = 'image';
	private transform = new TransformController();
	private loadingOverlay: HTMLElement | null = null;
	private triggerRect: DOMRect | null = null;

	constructor(settings: HoverZoomSettings) {
		this.settings = settings;
		this.initDOM();
	}

	private initDOM() {
		injectStyles();
		this.dom = createViewerDOM();
		if (this.dom) {
			this.transform.bindDOM(this.dom);
			this.setupActionCallbacks();
			this.ready = true;
		}
	}

	private setupActionCallbacks() {
		this.transform.onDownload = () => this.downloadMedia();
		this.transform.onCopyUrl = () => this.copyUrl();
		this.transform.onOpenNewTab = () => this.openInNewTab();
	}

	// --- Public API ---
	updateSettings(s: HoverZoomSettings) { this.settings = s; }
	getIsVisible() { return this.isVisible; }
	getCurrentUrl() { return this.currentSource?.url || ''; }

	rotate(angle: number) {
		this.transform.rotate(angle);
	}

	show(source: EnhancedResult, mouseX: number, mouseY: number) {
		console.log(LOG_TAG, 'show() called', source.type, source.url.slice(0, 60));

		if (!this.dom || !this.ready) {
			console.warn(LOG_TAG, 'Viewer not ready, trying to init');
			this.initDOM();
			if (!this.dom || !this.ready) return;
		}

		this.currentSource = source;
		this.currentType = source.type === 'video' ? 'video' : 'image';
		this.isVisible = true;
		this.transform.reset();
		this.triggerRect = source.element?.getBoundingClientRect() || null;

		// Show loading indicator on trigger element
		this.clearLoadingIndicator();
		if (source.element && this.settings.showLoadingIndicator && this.triggerRect) {
			this.showLoadingIndicator(this.triggerRect);
		}

		// Reset media elements
		this.dom.img.src = '';
		this.dom.img.style.opacity = '0';
		this.dom.img.style.display = 'none';
		this.dom.video.src = '';
		this.dom.video.style.display = 'none';
		this.dom.viewer.classList.remove('visible');

		if (this.currentType === 'video') {
			this.showVideo(source, mouseX, mouseY);
		} else {
			this.showImage(source, mouseX, mouseY);
		}
	}

	hide() {
		this.isVisible = false;
		this.currentSource = null;
		this.clearLoadingIndicator();
		if (this.dom) {
			this.dom.viewer.classList.remove('visible');
			this.dom.video.pause();
			this.dom.video.src = '';
		}
	}

	// --- Loading Indicator ---
	private showLoadingIndicator(rect: DOMRect) {
		const overlay = document.createElement('div');
		overlay.className = 'halo-hz-loading-overlay';
		overlay.style.cssText = `
			top: ${rect.top}px;
			left: ${rect.left}px;
			width: ${rect.width}px;
			height: ${rect.height}px;
		`;
		const spinner = document.createElement('div');
		spinner.className = 'halo-hz-loading-spinner';
		overlay.appendChild(spinner);
		document.body.appendChild(overlay);
		this.loadingOverlay = overlay;
	}

	private clearLoadingIndicator() {
		if (this.loadingOverlay) {
			this.loadingOverlay.remove();
			this.loadingOverlay = null;
		}
	}

	// --- Media Display ---
	private showImage(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;

		console.log(LOG_TAG, 'Loading image:', source.url.slice(0, 100));

		const preloadImg = new Image();
		preloadImg.referrerPolicy = 'no-referrer';

		preloadImg.onload = () => {
			console.log(LOG_TAG, 'Image loaded', preloadImg.naturalWidth, preloadImg.naturalHeight);
			if (!this.isVisible || !this.dom) return;

			this.clearLoadingIndicator();
			this.dom.img.style.display = 'block';
			this.dom.img.src = source.url;
			this.dom.img.style.opacity = '1';

			this.applyLayout(mouseX, mouseY, preloadImg.naturalWidth, preloadImg.naturalHeight);
			this.dom.viewer.classList.add('visible');
			updateInfoBar(this.dom, this.settings, source, 'image', this.dom.img);
		};

		preloadImg.onerror = (e) => {
			console.error(LOG_TAG, 'Image load error:', source.url.slice(0, 100), e);
			this.clearLoadingIndicator();
		};

		preloadImg.src = source.url;
	}

	private showVideo(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;

		console.log(LOG_TAG, 'Loading video:', source.url.slice(0, 100));

		// Check if URL is DASH segment - cannot play directly
		if (isDashSegment(source.url)) {
			console.warn(LOG_TAG, 'DASH m4s stream detected, falling back to thumbnail');
			this.fallbackToThumbnail(source, mouseX, mouseY);
			return;
		}

		// Check if URL looks like a playable video format
		if (!isPlayableVideoUrl(source.url)) {
			console.warn(LOG_TAG, 'Unrecognized video URL format, falling back to thumbnail');
			this.fallbackToThumbnail(source, mouseX, mouseY);
			return;
		}

		this.dom.video.style.display = 'block';
		this.dom.video.src = source.url;
		this.dom.video.muted = true;

		this.dom.video.onloadedmetadata = () => {
			console.log(LOG_TAG, 'Video loaded', this.dom?.video.videoWidth, this.dom?.video.videoHeight);
			if (!this.isVisible || !this.dom) return;

			this.clearLoadingIndicator();
			this.applyLayout(mouseX, mouseY, this.dom.video.videoWidth, this.dom.video.videoHeight);
			this.dom.viewer.classList.add('visible');
			updateInfoBar(this.dom, this.settings, source, 'video', this.dom.video);
		};

		this.dom.video.onerror = (e) => {
			console.error(LOG_TAG, 'Video load error:', source.url.slice(0, 100), e);
			this.clearLoadingIndicator();
			this.fallbackToThumbnail(source, mouseX, mouseY);
		};

		this.dom.video.play().catch(() => { });
	}

	private fallbackToThumbnail(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (this.dom) {
			this.dom.video.style.display = 'none';
			this.dom.video.src = '';
		}

		const thumbUrl = findThumbnailUrl(source.element);
		if (thumbUrl) {
			console.log(LOG_TAG, 'Using thumbnail fallback:', thumbUrl.slice(0, 80));
			this.currentType = 'image';
			this.showImage({ ...source, type: 'image', url: thumbUrl }, mouseX, mouseY);
		} else {
			console.warn(LOG_TAG, 'No thumbnail fallback available');
			this.clearLoadingIndicator();
		}
	}

	// --- Layout ---
	private applyLayout(mouseX: number, mouseY: number, contentW: number, contentH: number) {
		if (!this.dom || !contentW || !contentH) return;

		const triggerRect = this.triggerRect;
		const layout = calculateLayout(contentW, contentH, triggerRect, mouseX, mouseY);

		// Expand animation from source
		if (triggerRect && !this.dom.viewer.classList.contains('visible')) {
			this.dom.viewer.style.transition = 'none';
			Object.assign(this.dom.viewer.style, {
				width: `${triggerRect.width}px`,
				height: `${triggerRect.height}px`,
				top: `${triggerRect.top}px`,
				left: `${triggerRect.left}px`,
				opacity: '0'
			});
			this.dom.viewer.offsetHeight; // Force reflow
			this.dom.viewer.style.transition = 'all 0.15s cubic-bezier(0.2, 0, 0, 1)';
		}

		// Target position
		Object.assign(this.dom.viewer.style, {
			width: `${layout.width}px`,
			height: `${layout.height}px`,
			top: `${layout.top}px`,
			left: `${layout.left}px`,
			opacity: '1'
		});

		// Media fills container
		const media = this.currentType === 'video' ? this.dom.video : this.dom.img;
		media.style.width = `${layout.width}px`;
		media.style.height = `${layout.height}px`;
	}

	// --- Actions ---
	downloadMedia() {
		if (this.currentSource) {
			chrome.runtime.sendMessage({ type: 'HALO_DOWNLOAD', url: this.currentSource.url });
		}
	}

	copyUrl() {
		if (this.currentSource) {
			navigator.clipboard.writeText(this.currentSource.url);
		}
	}

	openInNewTab() {
		if (this.currentSource) {
			window.open(this.currentSource.url, '_blank');
		}
	}
}
