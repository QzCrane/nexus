// goal: DOM creation utilities for Hover Zoom viewer
// eff: Creates and manages viewer DOM structure

import { VIEWER_STYLES } from './styles';

export interface ViewerDOM {
	container: HTMLElement;
	viewer: HTMLElement;
	img: HTMLImageElement;
	video: HTMLVideoElement;
	spinner: HTMLElement;
	infoBar: HTMLElement;
	actionsBar: HTMLElement;
	zoomIndicator: HTMLElement;
}

export function injectStyles(): void {
	if (document.getElementById('halo-hz-styles')) return;
	const style = document.createElement('style');
	style.id = 'halo-hz-styles';
	style.textContent = VIEWER_STYLES;
	const appendStyle = () => document.head?.appendChild(style);
	if (document.head) appendStyle();
	else document.addEventListener('DOMContentLoaded', appendStyle, { once: true });
}

export function createViewerDOM(): ViewerDOM | null {
	if (!document.body) {
		console.warn('[HALO:HoverZoom] document.body not ready');
		return null;
	}

	const existing = document.getElementById('halo-hover-zoom-container');
	if (existing) return null;

	const container = document.createElement('div');
	container.id = 'halo-hover-zoom-container';

	const viewer = document.createElement('div');
	viewer.className = 'halo-hz-viewer';

	const img = document.createElement('img');
	img.className = 'halo-hz-image';

	const video = document.createElement('video');
	video.className = 'halo-hz-video';
	video.controls = false;
	video.autoplay = true;
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.style.display = 'none';

	const spinner = document.createElement('div');
	spinner.className = 'halo-hz-spinner';

	const infoBar = document.createElement('div');
	infoBar.className = 'halo-hz-info bottom';

	const actionsBar = document.createElement('div');
	actionsBar.className = 'halo-hz-actions';
	actionsBar.innerHTML = `
		<button class="halo-hz-action-btn" data-action="download" title="Download (S)">⬇</button>
		<button class="halo-hz-action-btn" data-action="copy" title="Copy URL (C)">📋</button>
		<button class="halo-hz-action-btn" data-action="newtab" title="Open (T)">↗</button>
		<button class="halo-hz-action-btn" data-action="rotate" title="Rotate (R)">↻</button>
	`;

	const zoomIndicator = document.createElement('div');
	zoomIndicator.className = 'halo-hz-zoom-indicator';

	viewer.append(img, video, spinner, infoBar, actionsBar, zoomIndicator);
	container.appendChild(viewer);
	document.body.appendChild(container);

	return { container, viewer, img, video, spinner, infoBar, actionsBar, zoomIndicator };
}

