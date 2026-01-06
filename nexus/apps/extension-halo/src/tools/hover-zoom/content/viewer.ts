// goal: Enhanced floating image/video viewer
// eff: Supports image/video display, zoom, pan, actions, and smooth animations

import { HoverZoomSettings } from '../types';
import { injectStyles, createViewerDOM, ViewerDOM } from './viewer-dom';
import type { EnhancedResult } from './rule-resolver';

const LOG_TAG = '[HALO:HoverZoom:Viewer]';

export class HoverZoomViewer {
	private dom: ViewerDOM | null = null;
	private settings: HoverZoomSettings;
	private ready = false;
	private isVisible = false;
	private currentSource: EnhancedResult | null = null;
	private currentType: 'image' | 'video' = 'image';
	private rotation = 0;
	private scale = 1;
	private panX = 0;
	private panY = 0;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private zoomTimer: number | null = null;

	constructor(settings: HoverZoomSettings) {
		this.settings = settings;
		this.initDOM();
	}

	private initDOM() {
		injectStyles();
		this.dom = createViewerDOM();
		if (this.dom) {
			this.bindEvents();
			this.ready = true;
		}
	}

	updateSettings(s: HoverZoomSettings) { this.settings = s; }
	getIsVisible() { return this.isVisible; }
	getCurrentUrl() { return this.currentSource?.url || ''; }

	private bindEvents() {
		if (!this.dom) return;
		this.dom.viewer.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
		this.dom.img.addEventListener('mousedown', this.onDragStart.bind(this));
		this.dom.video.addEventListener('mousedown', this.onDragStart.bind(this));
		window.addEventListener('mousemove', this.onDragMove.bind(this));
		window.addEventListener('mouseup', this.onDragEnd.bind(this));
		this.dom.actionsBar.addEventListener('click', this.onAction.bind(this));
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		this.scale = Math.max(0.5, Math.min(5, this.scale + (e.deltaY > 0 ? -0.1 : 0.1)));
		this.applyTransform();
		this.showZoomIndicator();
	}

	private onDragStart(e: MouseEvent) {
		if (this.scale <= 1) return;
		this.isDragging = true;
		this.dragStartX = e.clientX - this.panX;
		this.dragStartY = e.clientY - this.panY;
		this.dom?.viewer.classList.add('dragging');
	}

	private onDragMove(e: MouseEvent) {
		if (!this.isDragging) return;
		this.panX = e.clientX - this.dragStartX;
		this.panY = e.clientY - this.dragStartY;
		this.applyTransform();
	}

	private onDragEnd() {
		this.isDragging = false;
		this.dom?.viewer.classList.remove('dragging');
	}

	private onAction(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
		if (!btn) return;
		const action = btn.dataset.action;
		if (action === 'download') this.downloadMedia();
		else if (action === 'copy') this.copyUrl();
		else if (action === 'newtab') this.openInNewTab();
		else if (action === 'rotate') this.rotate(90);
	}

	/**
	 * Show image or video
	 */
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
		this.rotation = 0;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;

		// Reset both elements
		this.dom.img.src = '';
		this.dom.img.style.opacity = '0';
		this.dom.img.style.display = 'none';
		this.dom.video.src = '';
		this.dom.video.style.display = 'none';
		this.dom.spinner.style.display = 'block';
		this.dom.viewer.className = 'halo-hz-viewer visible';

		if (this.currentType === 'video') {
			this.showVideo(source, mouseX, mouseY);
		} else {
			this.showImage(source, mouseX, mouseY);
		}
	}

	private showImage(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;

		this.dom.img.style.display = 'block';
		this.dom.img.src = source.url;
		this.dom.img.onload = () => {
			console.log(LOG_TAG, 'Image loaded');
			if (!this.isVisible || !this.dom) return;
			this.dom.spinner.style.display = 'none';
			this.dom.img.style.opacity = '1';
			this.updateLayout(mouseX, mouseY, this.dom.img.naturalWidth, this.dom.img.naturalHeight);
			this.updateInfo(source);
		};
		this.dom.img.onerror = () => {
			console.error(LOG_TAG, 'Image load error');
			if (this.dom) this.dom.spinner.style.display = 'none';
		};
		this.updateLayout(mouseX, mouseY, 400, 300); // Placeholder size
	}

	private showVideo(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;

		// Note: DASH video+audio merge requires MSE, simplified to video-only for now
		console.log(LOG_TAG, 'Showing video:', source.url.slice(0, 80));

		this.dom.video.style.display = 'block';
		this.dom.video.src = source.url;
		this.dom.video.muted = true;

		this.dom.video.onloadedmetadata = () => {
			console.log(LOG_TAG, 'Video metadata loaded', this.dom?.video.videoWidth, this.dom?.video.videoHeight);
			if (!this.isVisible || !this.dom) return;
			this.dom.spinner.style.display = 'none';
			this.updateLayout(mouseX, mouseY, this.dom.video.videoWidth, this.dom.video.videoHeight);
			this.updateInfo(source);
		};

		this.dom.video.onerror = () => {
			console.error(LOG_TAG, 'Video load error');
			if (this.dom) this.dom.spinner.style.display = 'none';
		};

		this.dom.video.play().catch(() => { });
		this.updateLayout(mouseX, mouseY, 640, 360);
	}

	hide() {
		this.isVisible = false;
		this.currentSource = null;
		if (this.dom) {
			this.dom.viewer.classList.remove('visible');
			this.dom.video.pause();
			this.dom.video.src = '';
		}
	}

	private updateInfo(source: EnhancedResult) {
		if (!this.dom) return;
		if (this.settings.showImageInfo === 'none') {
			this.dom.infoBar.style.display = 'none';
			return;
		}
		this.dom.infoBar.style.display = 'flex';
		this.dom.infoBar.className = `halo-hz-info ${this.settings.showImageInfo}`;

		const typeLabel = this.currentType === 'video' ? '🎬' : '🖼️';
		const ruleLabel = source.fromRule ? `[${source.fromRule}]` : '';
		let dims = '';

		if (this.currentType === 'video' && this.dom.video.videoWidth) {
			dims = `${this.dom.video.videoWidth} × ${this.dom.video.videoHeight}`;
		} else if (this.dom.img.naturalWidth) {
			dims = `${this.dom.img.naturalWidth} × ${this.dom.img.naturalHeight}`;
		}

		this.dom.infoBar.innerHTML = `
			<div class="halo-hz-caption">${source.caption || ''}</div>
			<div class="halo-hz-meta">${typeLabel} ${dims} ${ruleLabel}</div>
		`;
	}

	private updateLayout(mouseX: number, mouseY: number, contentW: number, contentH: number) {
		if (!this.dom || !contentW || !contentH) return;

		const vpW = window.innerWidth, vpH = window.innerHeight;
		const margin = 20;
		const gap = 15;

		// Scale to fit viewport with padding
		const maxW = vpW - margin * 2;
		const maxH = vpH - margin * 2;
		const ratio = Math.min(maxW / contentW, maxH / contentH, 1);
		const renderW = contentW * ratio;
		const renderH = contentH * ratio;

		// Get trigger element bounds
		const trigger = this.currentSource?.element;
		const triggerRect = trigger?.getBoundingClientRect();

		let left: number, top: number;

		if (triggerRect) {
			// Try to position to the right of trigger
			if (triggerRect.right + gap + renderW <= vpW - margin) {
				left = triggerRect.right + gap;
			}
			// Try left of trigger
			else if (triggerRect.left - gap - renderW >= margin) {
				left = triggerRect.left - gap - renderW;
			}
			// Center horizontally
			else {
				left = (vpW - renderW) / 2;
			}

			// Vertical: center on trigger, clamped to viewport
			top = triggerRect.top + (triggerRect.height - renderH) / 2;
			top = Math.max(margin, Math.min(top, vpH - renderH - margin));
		} else {
			// Fallback: position near mouse
			left = mouseX + gap;
			if (left + renderW > vpW - margin) left = mouseX - renderW - gap;
			if (left < margin) left = (vpW - renderW) / 2;

			top = Math.max(margin, Math.min(mouseY - renderH / 2, vpH - renderH - margin));
		}

		Object.assign(this.dom.viewer.style, {
			width: `${renderW}px`,
			height: `${renderH}px`,
			top: `${top}px`,
			left: `${left}px`
		});

		const media = this.currentType === 'video' ? this.dom.video : this.dom.img;
		media.style.width = media.style.height = '100%';
	}

	rotate(angle: number) {
		this.rotation = (this.rotation + angle) % 360;
		this.applyTransform();
	}

	private applyTransform() {
		if (!this.dom) return;
		const transform = `scale(${this.scale}) rotate(${this.rotation}deg) translate(${this.panX / this.scale}px, ${this.panY / this.scale}px)`;
		this.dom.img.style.transform = transform;
		this.dom.video.style.transform = transform;
	}

	private showZoomIndicator() {
		if (!this.dom) return;
		this.dom.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
		this.dom.zoomIndicator.classList.add('visible');
		if (this.zoomTimer) clearTimeout(this.zoomTimer);
		this.zoomTimer = window.setTimeout(() => this.dom?.zoomIndicator.classList.remove('visible'), 800);
	}

	downloadMedia() {
		if (this.currentSource) chrome.runtime.sendMessage({ type: 'HALO_DOWNLOAD', url: this.currentSource.url });
	}

	copyUrl() {
		if (this.currentSource) navigator.clipboard.writeText(this.currentSource.url);
	}

	openInNewTab() {
		if (this.currentSource) window.open(this.currentSource.url, '_blank');
	}
}
