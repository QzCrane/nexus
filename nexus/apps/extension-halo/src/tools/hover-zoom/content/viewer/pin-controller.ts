// goal: Pin mode controller for Hover Zoom viewer
// eff: Enables drag-to-move, resize, and close button when pinned

import type { ViewerDOM } from '../viewer-dom';

const MIN_SIZE = 100;
const RESIZE_HANDLE_SIZE = 12;

interface PinState {
	isPinned: boolean;
	isDragging: boolean;
	isResizing: boolean;
	dragStartX: number;
	dragStartY: number;
	resizeStartW: number;
	resizeStartH: number;
	resizeCorner: string;  // 'se' | 'sw' | 'ne' | 'nw'
}

/**
 * Controller for pinned viewer mode.
 * Enables: drag-to-move, corner-resize, close button.
 */
export class PinController {
	private dom: ViewerDOM | null = null;
	private state: PinState = {
		isPinned: false, isDragging: false, isResizing: false,
		dragStartX: 0, dragStartY: 0,
		resizeStartW: 0, resizeStartH: 0, resizeCorner: 'se'
	};
	private closeBtn: HTMLElement | null = null;
	private pinIndicator: HTMLElement | null = null;
	public onClose?: () => void;

	bindDOM(dom: ViewerDOM) {
		this.dom = dom;
		this.createElements();
		this.bindEvents();
	}

	private createElements() {
		if (!this.dom) return;

		// Close button (X) - only visible when pinned
		this.closeBtn = document.createElement('button');
		this.closeBtn.className = 'halo-hz-close-btn';
		this.closeBtn.innerHTML = '×';
		this.closeBtn.title = 'Close (Esc)';
		this.closeBtn.style.display = 'none';
		this.dom.viewer.appendChild(this.closeBtn);

		// Pin indicator (📌) - shows when pinned
		this.pinIndicator = document.createElement('div');
		this.pinIndicator.className = 'halo-hz-pin-indicator';
		this.pinIndicator.innerHTML = '📌';
		this.pinIndicator.style.display = 'none';
		this.dom.viewer.appendChild(this.pinIndicator);
	}

	private bindEvents() {
		if (!this.dom) return;
		// Close button
		this.closeBtn?.addEventListener('click', (e) => {
			e.stopPropagation();
			this.onClose?.();
		});

		// Drag on viewer header area (top 30px)
		this.dom.viewer.addEventListener('mousedown', this.handleMouseDown.bind(this));
		window.addEventListener('mousemove', this.handleMouseMove.bind(this));
		window.addEventListener('mouseup', this.handleMouseUp.bind(this));
	}

	pin() {
		if (!this.dom) return;
		this.state.isPinned = true;
		this.dom.viewer.classList.add('pinned');
		this.dom.viewer.classList.add('interactive');
		if (this.closeBtn) this.closeBtn.style.display = '';
		if (this.pinIndicator) this.pinIndicator.style.display = '';
	}

	unpin() {
		if (!this.dom) return;
		this.state.isPinned = false;
		this.dom.viewer.classList.remove('pinned');
		this.dom.viewer.classList.remove('interactive');
		if (this.closeBtn) this.closeBtn.style.display = 'none';
		if (this.pinIndicator) this.pinIndicator.style.display = 'none';
	}

	isPinned(): boolean {
		return this.state.isPinned;
	}

	reset() {
		this.state = {
			isPinned: false, isDragging: false, isResizing: false,
			dragStartX: 0, dragStartY: 0,
			resizeStartW: 0, resizeStartH: 0, resizeCorner: 'se'
		};
		this.unpin();
	}

	private handleMouseDown(e: MouseEvent) {
		if (!this.state.isPinned || !this.dom) return;
		const rect = this.dom.viewer.getBoundingClientRect();

		// Check if clicking near corners for resize
		const corner = this.detectCorner(e, rect);
		if (corner) {
			this.startResize(e, rect, corner);
			return;
		}

		// Check if clicking in drag area (top 30px excluding close button)
		const isInDragArea = e.clientY < rect.top + 30 && e.clientX < rect.right - 40;
		if (isInDragArea) {
			this.startDrag(e, rect);
		}
	}

	private detectCorner(e: MouseEvent, rect: DOMRect): string | null {
		const x = e.clientX, y = e.clientY;
		const inLeft = x < rect.left + RESIZE_HANDLE_SIZE;
		const inRight = x > rect.right - RESIZE_HANDLE_SIZE;
		const inTop = y < rect.top + RESIZE_HANDLE_SIZE;
		const inBottom = y > rect.bottom - RESIZE_HANDLE_SIZE;

		if (inBottom && inRight) return 'se';
		if (inBottom && inLeft) return 'sw';
		if (inTop && inRight) return 'ne';
		if (inTop && inLeft) return 'nw';
		return null;
	}

	private startDrag(e: MouseEvent, rect: DOMRect) {
		e.preventDefault();
		this.state.isDragging = true;
		this.state.dragStartX = e.clientX - rect.left;
		this.state.dragStartY = e.clientY - rect.top;
		this.dom?.viewer.classList.add('dragging');
	}

	private startResize(e: MouseEvent, rect: DOMRect, corner: string) {
		e.preventDefault();
		this.state.isResizing = true;
		this.state.resizeCorner = corner;
		this.state.dragStartX = e.clientX;
		this.state.dragStartY = e.clientY;
		this.state.resizeStartW = rect.width;
		this.state.resizeStartH = rect.height;
		this.dom?.viewer.classList.add('resizing');
	}

	private handleMouseMove(e: MouseEvent) {
		if (!this.dom) return;

		if (this.state.isDragging) {
			const newLeft = e.clientX - this.state.dragStartX;
			const newTop = e.clientY - this.state.dragStartY;
			this.dom.viewer.style.left = `${newLeft}px`;
			this.dom.viewer.style.top = `${newTop}px`;
			return;
		}

		if (this.state.isResizing) {
			this.handleResize(e);
			return;
		}

		// Update cursor based on hover position
		if (this.state.isPinned) {
			this.updateCursor(e);
		}
	}

	private handleResize(e: MouseEvent) {
		if (!this.dom) return;
		const dx = e.clientX - this.state.dragStartX;
		const dy = e.clientY - this.state.dragStartY;
		const corner = this.state.resizeCorner;

		let newW = this.state.resizeStartW;
		let newH = this.state.resizeStartH;

		if (corner.includes('e')) newW = Math.max(MIN_SIZE, this.state.resizeStartW + dx);
		if (corner.includes('w')) newW = Math.max(MIN_SIZE, this.state.resizeStartW - dx);
		if (corner.includes('s')) newH = Math.max(MIN_SIZE, this.state.resizeStartH + dy);
		if (corner.includes('n')) newH = Math.max(MIN_SIZE, this.state.resizeStartH - dy);

		this.dom.viewer.style.width = `${newW}px`;
		this.dom.viewer.style.height = `${newH}px`;

		// Adjust position for nw/ne/sw corners
		const rect = this.dom.viewer.getBoundingClientRect();
		if (corner.includes('w')) {
			this.dom.viewer.style.left = `${e.clientX}px`;
		}
		if (corner.includes('n')) {
			this.dom.viewer.style.top = `${e.clientY}px`;
		}

		// Update media element size to fill
		this.dom.img.style.width = '100%';
		this.dom.img.style.height = '100%';
		this.dom.img.style.objectFit = 'contain';
		this.dom.video.style.width = '100%';
		this.dom.video.style.height = '100%';
		this.dom.video.style.objectFit = 'contain';
	}

	private handleMouseUp() {
		this.state.isDragging = false;
		this.state.isResizing = false;
		this.dom?.viewer.classList.remove('dragging', 'resizing');
	}

	private updateCursor(e: MouseEvent) {
		if (!this.dom) return;
		const rect = this.dom.viewer.getBoundingClientRect();
		const corner = this.detectCorner(e, rect);

		if (corner === 'se' || corner === 'nw') {
			this.dom.viewer.style.cursor = 'nwse-resize';
		} else if (corner === 'sw' || corner === 'ne') {
			this.dom.viewer.style.cursor = 'nesw-resize';
		} else if (e.clientY < rect.top + 30 && e.clientX < rect.right - 40) {
			this.dom.viewer.style.cursor = 'move';
		} else {
			this.dom.viewer.style.cursor = '';
		}
	}
}
