// goal: Enhanced floating image viewer
// eff: Supports zoom, pan, actions, and smooth animations

import { HoverZoomSettings, ViewMode } from '../types';
import { ImageSource } from './image-resolver';
import { injectStyles, createViewerDOM, ViewerDOM } from './viewer-dom';

export class HoverZoomViewer {
	private dom: ViewerDOM;
	private settings: HoverZoomSettings;

	// State
	private isVisible = false;
	private currentSource: ImageSource | null = null;
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
		injectStyles();
		this.dom = createViewerDOM();
		this.bindEvents();
	}

	updateSettings(s: HoverZoomSettings) { this.settings = s; }
	getIsVisible() { return this.isVisible; }
	getCurrentUrl() { return this.currentSource?.url || ''; }

	private bindEvents() {
		this.dom.viewer.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
		this.dom.img.addEventListener('mousedown', this.onDragStart.bind(this));
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
		this.dom.viewer.classList.add('dragging');
	}

	private onDragMove(e: MouseEvent) {
		if (!this.isDragging) return;
		this.panX = e.clientX - this.dragStartX;
		this.panY = e.clientY - this.dragStartY;
		this.applyTransform();
	}

	private onDragEnd() {
		this.isDragging = false;
		this.dom.viewer.classList.remove('dragging');
	}

	private onAction(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
		if (!btn) return;
		const action = btn.dataset.action;
		if (action === 'download') this.downloadImage();
		else if (action === 'copy') this.copyUrl();
		else if (action === 'newtab') this.openInNewTab();
		else if (action === 'rotate') this.rotate(90);
	}

	show(source: ImageSource, mouseX: number, mouseY: number) {
		this.currentSource = source;
		this.isVisible = true;
		this.rotation = 0;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;

		this.dom.img.src = '';
		this.dom.img.style.opacity = '0';
		this.dom.spinner.style.display = 'block';
		this.dom.viewer.className = 'halo-hz-viewer visible';

		this.dom.img.src = source.url;
		this.dom.img.onload = () => {
			if (!this.isVisible) return;
			this.dom.spinner.style.display = 'none';
			this.dom.img.style.opacity = '1';
			this.updateLayout(mouseX, mouseY);
			this.updateInfo(source);
		};
		this.dom.img.onerror = () => { this.dom.spinner.style.display = 'none'; };
		this.updateLayout(mouseX, mouseY);
	}

	hide() {
		this.isVisible = false;
		this.currentSource = null;
		this.dom.viewer.classList.remove('visible');
	}

	private updateInfo(source: ImageSource) {
		if (this.settings.showImageInfo === 'none') {
			this.dom.infoBar.style.display = 'none';
			return;
		}
		this.dom.infoBar.style.display = 'flex';
		this.dom.infoBar.className = `halo-hz-info ${this.settings.showImageInfo}`;
		const dims = `${this.dom.img.naturalWidth} × ${this.dom.img.naturalHeight}`;
		const ext = source.url.split('.').pop()?.split('?')[0]?.toUpperCase() || 'IMG';
		this.dom.infoBar.innerHTML = `
            <div class="halo-hz-caption">${source.caption || ''}</div>
            <div class="halo-hz-meta">${dims} · ${ext}</div>
        `;
	}

	private updateLayout(mouseX: number, mouseY: number) {
		if (!this.dom.img.naturalWidth) return;
		const vpW = window.innerWidth, vpH = window.innerHeight;
		const imgW = this.dom.img.naturalWidth, imgH = this.dom.img.naturalHeight;
		const ratio = Math.min((vpW * 0.7) / imgW, (vpH * 0.8) / imgH, 1);
		const renderW = imgW * ratio, renderH = imgH * ratio;
		const gap = 25;

		let left = mouseX + gap, top = Math.max(20, Math.min(mouseY - renderH / 2, vpH - renderH - 20));
		if (left + renderW > vpW - 20) left = mouseX - renderW - gap;
		if (left < 20) { left = (vpW - renderW) / 2; top = (vpH - renderH) / 2; }

		Object.assign(this.dom.viewer.style, { width: `${renderW}px`, height: `${renderH}px`, top: `${top}px`, left: `${left}px` });
		this.dom.img.style.width = this.dom.img.style.height = '100%';
	}

	rotate(angle: number) { this.rotation = (this.rotation + angle) % 360; this.applyTransform(); }

	private applyTransform() {
		this.dom.img.style.transform = `scale(${this.scale}) rotate(${this.rotation}deg) translate(${this.panX / this.scale}px, ${this.panY / this.scale}px)`;
	}

	private showZoomIndicator() {
		this.dom.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
		this.dom.zoomIndicator.classList.add('visible');
		if (this.zoomTimer) clearTimeout(this.zoomTimer);
		this.zoomTimer = window.setTimeout(() => this.dom.zoomIndicator.classList.remove('visible'), 800);
	}

	downloadImage() { if (this.currentSource) chrome.runtime.sendMessage({ type: 'HALO_DOWNLOAD', url: this.currentSource.url }); }
	copyUrl() { if (this.currentSource) navigator.clipboard.writeText(this.currentSource.url); }
	openInNewTab() { if (this.currentSource) window.open(this.currentSource.url, '_blank'); }
}
