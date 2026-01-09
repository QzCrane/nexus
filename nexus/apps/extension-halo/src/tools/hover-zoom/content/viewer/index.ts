// goal: Enhanced floating image/video viewer (main entry)
// eff: Orchestrates layout, transform, info, and media display

import { HoverZoomSettings } from '../../types';
import { injectStyles, createViewerDOM, ViewerDOM } from '../viewer-dom';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { TransformController } from './transform';
import { LoadingOverlay } from './loading-overlay';
import { downloadMedia, copyUrl, openInNewTab } from './viewer-actions';
import { showImage, showVideo, fallbackToThumbnail, cleanupMSE } from './media-display';

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
	private loadingOverlay = new LoadingOverlay();
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
		this.transform.onDownload = () => downloadMedia(this.currentSource);
		this.transform.onCopyUrl = () => copyUrl(this.currentSource);
		this.transform.onOpenNewTab = () => openInNewTab(this.currentSource);
	}

	// --- Public API ---
	updateSettings(s: HoverZoomSettings) { this.settings = s; }
	getIsVisible() { return this.isVisible; }
	getCurrentUrl() { return this.currentSource?.url || ''; }

	rotate(angle: number) {
		this.transform.rotate(angle);
	}

	downloadMedia() { downloadMedia(this.currentSource); }
	copyUrl() { copyUrl(this.currentSource); }
	openInNewTab() { openInNewTab(this.currentSource); }

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
		this.loadingOverlay.clear();
		if (source.element && this.settings.showLoadingIndicator && this.triggerRect) {
			this.loadingOverlay.show(this.triggerRect);
		}

		// Reset media elements - keep container hidden until media loaded
		this.dom.container.style.display = 'none';  // Hide until ready
		this.dom.viewer.classList.remove('visible');
		this.dom.viewer.style.cssText = '';  // Clear inline styles
		this.dom.img.src = '';
		this.dom.img.style.opacity = '0';
		this.dom.img.style.display = 'none';
		this.dom.video.src = '';
		this.dom.video.style.display = 'none';

		const onLoaded = () => this.loadingOverlay.clear();
		const onError = () => this.loadingOverlay.clear();

		if (this.currentType === 'video') {
			showVideo(
				this.dom,
				this.settings,
				source,
				mouseX,
				mouseY,
				this.triggerRect,
				this.currentType,
				() => this.isVisible,
				onLoaded,
				onError,
				(s, x, y) => this.fallbackToThumbnail(s, x, y)
			);
		} else {
			showImage(
				this.dom,
				this.settings,
				source,
				mouseX,
				mouseY,
				this.triggerRect,
				this.currentType,
				() => this.isVisible,
				onLoaded,
				onError
			);
		}
	}

	hide() {
		this.isVisible = false;
		this.currentSource = null;
		this.loadingOverlay.clear();
		cleanupMSE();  // Release MSE resources
		if (this.dom) {
			this.dom.viewer.classList.remove('visible');
			this.dom.viewer.classList.remove('interactive');
			this.dom.container.style.display = 'none';
			this.dom.video.pause();
			this.dom.video.src = '';
		}
	}

	private fallbackToThumbnail(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;
		// Check if fallback is disabled
		if (!this.settings.videoFallbackToImage) {
			console.log(LOG_TAG, 'Video fallback disabled, hiding viewer');
			this.hide();
			return;
		}
		fallbackToThumbnail(
			this.dom,
			source,
			mouseX,
			mouseY,
			this.triggerRect,
			() => this.isVisible,
			() => this.loadingOverlay.clear(),
			() => this.loadingOverlay.clear(),
			(type) => { this.currentType = type; }
		);
	}
}
