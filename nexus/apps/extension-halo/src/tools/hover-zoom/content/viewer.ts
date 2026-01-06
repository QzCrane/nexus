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

		// Use trigger element size as initial estimate
		const triggerRect = source.element?.getBoundingClientRect();
		const estW = Math.max(triggerRect?.width || 200, 200);
		const estH = Math.max(triggerRect?.height || 150, 150);

		this.dom.img.style.display = 'block';
		this.dom.img.src = source.url;
		this.dom.img.onload = () => {
			console.log(LOG_TAG, 'Image loaded', this.dom?.img.naturalWidth, this.dom?.img.naturalHeight);
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
		this.updateLayout(mouseX, mouseY, estW, estH);
	}

	private showVideo(source: EnhancedResult, mouseX: number, mouseY: number) {
		if (!this.dom) return;

		// Use trigger element size as initial estimate (16:9 ratio)
		const triggerRect = source.element?.getBoundingClientRect();
		const estW = Math.max(triggerRect?.width || 320, 320);
		const estH = Math.max(triggerRect?.height || 180, 180);

		console.log(LOG_TAG, 'Showing video:', source.url.slice(0, 80));

		this.dom.video.style.display = 'block';
		this.dom.video.src = source.url;
		this.dom.video.muted = true;

		this.dom.video.onloadedmetadata = () => {
			console.log(LOG_TAG, 'Video loaded', this.dom?.video.videoWidth, this.dom?.video.videoHeight);
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
		this.updateLayout(mouseX, mouseY, estW, estH);
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

	/**
	 * Calculate optimal layout position and size
	 * Algorithm:
	 * 1. Evaluate all 4 directions (Right/Left/Bottom/Top)
	 * 2. For each direction, calculate max displayable size with edge-alignment constraint
	 *    - Edge constraint: trigger's edge range must be within viewer's parallel edge range
	 * 3. Choose the direction with largest display area
	 * 4. Scale down only if no direction can fit the original size
	 */
	private updateLayout(mouseX: number, mouseY: number, contentW: number, contentH: number) {
		if (!this.dom || !contentW || !contentH) return;

		const vpW = window.innerWidth, vpH = window.innerHeight;
		const margin = 15;
		const gap = 10;
		const aspectRatio = contentW / contentH;

		const trigger = this.currentSource?.element;
		const tr = trigger?.getBoundingClientRect();

		let finalLeft: number, finalTop: number, finalW: number, finalH: number;

		if (tr) {
			// Calculate available space in each direction
			const spaceRight = vpW - tr.right - margin - gap;
			const spaceLeft = tr.left - margin - gap;
			const spaceBottom = vpH - tr.bottom - margin - gap;
			const spaceTop = tr.top - margin - gap;

			// For horizontal placement (Right/Left): available height is full viewport minus margins
			// For vertical placement (Bottom/Top): available width is full viewport minus margins
			const availH_horizontal = vpH - margin * 2;
			const availW_vertical = vpW - margin * 2;

			interface Candidate {
				dir: 'right' | 'left' | 'bottom' | 'top';
				w: number;
				h: number;
				area: number;
				left: number;
				top: number;
			}

			const candidates: Candidate[] = [];

			// Helper: calculate best size for given max width and max height, respecting aspect ratio
			const calcSize = (maxW: number, maxH: number): { w: number; h: number } => {
				if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
				// Don't scale up beyond original size
				const scale = Math.min(maxW / contentW, maxH / contentH, 1);
				return { w: contentW * scale, h: contentH * scale };
			};

			// Helper: calculate vertical position ensuring trigger's vertical range is within viewer's range
			// triggerTop/triggerBottom must be within [viewerTop, viewerTop + viewerH]
			const calcVerticalPos = (viewerH: number): number => {
				// Viewer must cover trigger's vertical span
				// viewerTop <= tr.top && viewerTop + viewerH >= tr.bottom
				const minTop = Math.max(margin, tr.bottom - viewerH);
				const maxTop = Math.min(vpH - viewerH - margin, tr.top);
				if (minTop > maxTop) {
					// Can't satisfy constraint, center on trigger
					return Math.max(margin, Math.min(tr.top + (tr.height - viewerH) / 2, vpH - viewerH - margin));
				}
				// Prefer centering on trigger within valid range
				const centered = tr.top + (tr.height - viewerH) / 2;
				return Math.max(minTop, Math.min(centered, maxTop));
			};

			// Helper: calculate horizontal position ensuring trigger's horizontal range is within viewer's range
			const calcHorizontalPos = (viewerW: number): number => {
				const minLeft = Math.max(margin, tr.right - viewerW);
				const maxLeft = Math.min(vpW - viewerW - margin, tr.left);
				if (minLeft > maxLeft) {
					return Math.max(margin, Math.min(tr.left + (tr.width - viewerW) / 2, vpW - viewerW - margin));
				}
				const centered = tr.left + (tr.width - viewerW) / 2;
				return Math.max(minLeft, Math.min(centered, maxLeft));
			};

			// RIGHT: viewer placed to the right of trigger
			if (spaceRight > 0) {
				const size = calcSize(spaceRight, availH_horizontal);
				if (size.w > 0 && size.h > 0) {
					candidates.push({
						dir: 'right',
						w: size.w,
						h: size.h,
						area: size.w * size.h,
						left: tr.right + gap,
						top: calcVerticalPos(size.h)
					});
				}
			}

			// LEFT: viewer placed to the left of trigger
			if (spaceLeft > 0) {
				const size = calcSize(spaceLeft, availH_horizontal);
				if (size.w > 0 && size.h > 0) {
					candidates.push({
						dir: 'left',
						w: size.w,
						h: size.h,
						area: size.w * size.h,
						left: tr.left - gap - size.w,
						top: calcVerticalPos(size.h)
					});
				}
			}

			// BOTTOM: viewer placed below trigger
			if (spaceBottom > 0) {
				const size = calcSize(availW_vertical, spaceBottom);
				if (size.w > 0 && size.h > 0) {
					candidates.push({
						dir: 'bottom',
						w: size.w,
						h: size.h,
						area: size.w * size.h,
						left: calcHorizontalPos(size.w),
						top: tr.bottom + gap
					});
				}
			}

			// TOP: viewer placed above trigger
			if (spaceTop > 0) {
				const size = calcSize(availW_vertical, spaceTop);
				if (size.w > 0 && size.h > 0) {
					candidates.push({
						dir: 'top',
						w: size.w,
						h: size.h,
						area: size.w * size.h,
						left: calcHorizontalPos(size.w),
						top: tr.top - gap - size.h
					});
				}
			}

			// Select the candidate with largest area
			if (candidates.length > 0) {
				candidates.sort((a, b) => b.area - a.area);
				const best = candidates[0];
				finalLeft = best.left;
				finalTop = best.top;
				finalW = best.w;
				finalH = best.h;
			} else {
				// Fallback: no valid direction, use largest available space
				const maxW = vpW - margin * 2;
				const maxH = vpH - margin * 2;
				const scale = Math.min(maxW / contentW, maxH / contentH, 1);
				finalW = contentW * scale;
				finalH = contentH * scale;
				finalLeft = (vpW - finalW) / 2;
				finalTop = (vpH - finalH) / 2;
			}
		} else {
			// No trigger element - position near mouse
			const maxW = vpW - margin * 2;
			const maxH = vpH - margin * 2;
			const scale = Math.min(maxW / contentW, maxH / contentH, 1);
			finalW = contentW * scale;
			finalH = contentH * scale;

			finalLeft = mouseX + gap;
			if (finalLeft + finalW > vpW - margin) finalLeft = mouseX - finalW - gap;
			if (finalLeft < margin) finalLeft = margin;
			finalTop = Math.max(margin, Math.min(mouseY - finalH / 2, vpH - finalH - margin));
		}

		Object.assign(this.dom.viewer.style, {
			width: `${finalW}px`,
			height: `${finalH}px`,
			top: `${finalTop}px`,
			left: `${finalLeft}px`
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
