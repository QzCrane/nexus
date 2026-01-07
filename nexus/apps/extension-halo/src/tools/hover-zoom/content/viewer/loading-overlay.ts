
/**
 * Manages the loading spinner overlay
 */
export class LoadingOverlay {
	private overlay: HTMLElement | null = null;

	show(rect: DOMRect) {
		this.clear();
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
		this.overlay = overlay;
	}

	clear() {
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = null;
		}
	}
}
