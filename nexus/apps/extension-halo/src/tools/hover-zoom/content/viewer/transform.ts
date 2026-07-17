// goal: Transform and interaction handlers for HoverZoom viewer
// eff: Handle zoom, pan, rotate, and action button events

import type { ViewerDOM } from '../viewer-dom';

/**
 * Transform state for viewer content
 */
export interface TransformState {
	scale: number;
	rotation: number;
	panX: number;
	panY: number;
}

/**
 * Drag state for pan interaction
 */
interface DragState {
	isDragging: boolean;
	startX: number;
	startY: number;
}

/**
 * Transform controller for viewer content.
 * Handles zoom (wheel), pan (drag), rotate, and action buttons.
 */
export class TransformController {
	private state: TransformState = { scale: 1, rotation: 0, panX: 0, panY: 0 };
	private drag: DragState = { isDragging: false, startX: 0, startY: 0 };
	private zoomTimer: number | null = null;
	private dom: ViewerDOM | null = null;
	private boundWheel?: (e: WheelEvent) => void;
	private boundDragStart?: (e: MouseEvent) => void;
	private boundDragMove?: (e: MouseEvent) => void;
	private boundDragEnd?: (e: MouseEvent) => void;
	private boundAction?: (e: MouseEvent) => void;

	// Callbacks
	public onDownload?: () => void;
	public onCopyUrl?: () => void;
	public onOpenNewTab?: () => void;

	/**
	 * Bind DOM and initialize event listeners.
	 */
	bindDOM(dom: ViewerDOM) {
		this.dom = dom;
		this.bindEvents();
	}

	/**
	 * Reset transform state to initial values.
	 */
	reset() {
		this.state = { scale: 1, rotation: 0, panX: 0, panY: 0 };
		this.drag = { isDragging: false, startX: 0, startY: 0 };
	}

	/**
	 * Get current transform state (for external use).
	 */
	getState(): Readonly<TransformState> {
		return this.state;
	}

	/**
	 * Apply current transform to both image and video elements.
	 */
	applyTransform() {
		if (!this.dom) return;
		const { scale, rotation, panX, panY } = this.state;
		const transform = `scale(${scale}) rotate(${rotation}deg) translate(${panX / scale}px, ${panY / scale}px)`;
		this.dom.img.style.transform = transform;
		this.dom.video.style.transform = transform;
	}

	/**
	 * Rotate content by specified angle.
	 */
	rotate(angle: number) {
		this.state.rotation = (this.state.rotation + angle) % 360;
		this.applyTransform();
	}

	// --- Private Methods ---

	private bindEvents() {
		if (!this.dom) return;
		this.boundWheel = this.onWheel.bind(this);
		this.boundDragStart = this.onDragStart.bind(this);
		this.boundDragMove = this.onDragMove.bind(this);
		this.boundDragEnd = this.onDragEnd.bind(this);
		this.boundAction = this.onAction.bind(this);
		this.dom.viewer.addEventListener('wheel', this.boundWheel, { passive: false });
		this.dom.img.addEventListener('mousedown', this.boundDragStart);
		this.dom.video.addEventListener('mousedown', this.boundDragStart);
		window.addEventListener('mousemove', this.boundDragMove);
		window.addEventListener('mouseup', this.boundDragEnd);
		this.dom.actionsBar.addEventListener('click', this.boundAction);
	}

	destroy() {
		if (this.zoomTimer) {
			clearTimeout(this.zoomTimer);
			this.zoomTimer = null;
		}
		if (this.boundWheel && this.dom) {
			this.dom.viewer.removeEventListener('wheel', this.boundWheel);
			this.boundWheel = undefined;
		}
		if (this.boundDragStart && this.dom) {
			this.dom.img.removeEventListener('mousedown', this.boundDragStart);
			this.dom.video.removeEventListener('mousedown', this.boundDragStart);
			this.boundDragStart = undefined;
		}
		if (this.boundDragMove) {
			window.removeEventListener('mousemove', this.boundDragMove);
			this.boundDragMove = undefined;
		}
		if (this.boundDragEnd) {
			window.removeEventListener('mouseup', this.boundDragEnd);
			this.boundDragEnd = undefined;
		}
		if (this.boundAction && this.dom) {
			this.dom.actionsBar.removeEventListener('click', this.boundAction);
			this.boundAction = undefined;
		}
		this.dom = null;
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		this.state.scale = Math.max(0.5, Math.min(5, this.state.scale + (e.deltaY > 0 ? -0.1 : 0.1)));
		this.applyTransform();
		this.showZoomIndicator();
	}

	private onDragStart(e: MouseEvent) {
		if (this.state.scale <= 1) return;
		this.drag.isDragging = true;
		this.drag.startX = e.clientX - this.state.panX;
		this.drag.startY = e.clientY - this.state.panY;
		this.dom?.viewer.classList.add('dragging');
	}

	private onDragMove(e: MouseEvent) {
		if (!this.drag.isDragging) return;
		this.state.panX = e.clientX - this.drag.startX;
		this.state.panY = e.clientY - this.drag.startY;
		this.applyTransform();
	}

	private onDragEnd() {
		this.drag.isDragging = false;
		this.dom?.viewer.classList.remove('dragging');
	}

	private onAction(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
		if (!btn) return;
		const action = btn.dataset.action;
		if (action === 'download') this.onDownload?.();
		else if (action === 'copy') this.onCopyUrl?.();
		else if (action === 'newtab') this.onOpenNewTab?.();
		else if (action === 'rotate') this.rotate(90);
	}

	private showZoomIndicator() {
		if (!this.dom) return;
		this.dom.zoomIndicator.textContent = `${Math.round(this.state.scale * 100)}%`;
		this.dom.zoomIndicator.classList.add('visible');
		if (this.zoomTimer) clearTimeout(this.zoomTimer);
		this.zoomTimer = window.setTimeout(() => this.dom?.zoomIndicator.classList.remove('visible'), 800);
	}
}
