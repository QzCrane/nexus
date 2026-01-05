// goal: DOM creation utilities for Hover Zoom viewer
// eff: Creates and manages viewer DOM structure

import { VIEWER_STYLES } from './styles';

export interface ViewerDOM {
	container: HTMLElement;
	viewer: HTMLElement;
	img: HTMLImageElement;
	spinner: HTMLElement;
	infoBar: HTMLElement;
	actionsBar: HTMLElement;
	zoomIndicator: HTMLElement;
}

export function injectStyles(): void {
	if (!document.getElementById('halo-hz-styles')) {
		const style = document.createElement('style');
		style.id = 'halo-hz-styles';
		style.textContent = VIEWER_STYLES;
		document.head.appendChild(style);
	}
}

export function createViewerDOM(): ViewerDOM {
	const container = document.createElement('div');
	container.id = 'halo-hover-zoom-container';

	const viewer = document.createElement('div');
	viewer.className = 'halo-hz-viewer';

	const img = document.createElement('img');
	img.className = 'halo-hz-image';

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

	viewer.append(img, spinner, infoBar, actionsBar, zoomIndicator);
	container.appendChild(viewer);
	document.body.appendChild(container);

	return { container, viewer, img, spinner, infoBar, actionsBar, zoomIndicator };
}
