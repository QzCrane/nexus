import type { ViewerDOM } from '../viewer-dom';
import { MIN_SIZE, RESIZE_HANDLE_SIZE } from './pin-constants';
import { detectCorner, calculateResize, getCursorStyle } from './pin-utils';

interface PinState {
	isPinned: boolean;
	isDragging: boolean;
	isResizing: boolean;
	dragStartX: number;
	dragStartY: number;
	resizeStartW: number;
	resizeStartH: number;
	resizeCorner: string;
}

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
		this.closeBtn = document.createElement('button');
		this.closeBtn.className = 'halo-hz-close-btn';
		this.closeBtn.innerHTML = '×';
		this.closeBtn.title = 'Close (Esc)';
		this.closeBtn.style.display = 'none';
		this.dom.viewer.appendChild(this.closeBtn);

		this.pinIndicator = document.createElement('div');
		this.pinIndicator.className = 'halo-hz-pin-indicator';
		this.pinIndicator.innerHTML = '📌';
		this.pinIndicator.style.display = 'none';
		this.dom.viewer.appendChild(this.pinIndicator);
	}

	private bindEvents() {
		if (!this.dom) return;
		this.closeBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.onClose?.(); });
		this.dom.viewer.addEventListener('mousedown', this.handleMouseDown.bind(this));
		window.addEventListener('mousemove', this.handleMouseMove.bind(this));
		window.addEventListener('mouseup', this.handleMouseUp.bind(this));
	}

	pin() {
		if (!this.dom) return;
		this.state.isPinned = true;
		this.dom.viewer.classList.add('pinned', 'interactive');
		if (this.closeBtn) this.closeBtn.style.display = '';
		if (this.pinIndicator) this.pinIndicator.style.display = '';
	}

	unpin() {
		if (!this.dom) return;
		this.state.isPinned = false;
		this.dom.viewer.classList.remove('pinned', 'interactive');
		if (this.closeBtn) this.closeBtn.style.display = 'none';
		if (this.pinIndicator) this.pinIndicator.style.display = 'none';
	}

	isPinned(): boolean { return this.state.isPinned; }

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
		const corner = detectCorner(e, rect);
		if (corner) { this.startResize(e, rect, corner); return; }
		if (e.clientY < rect.top + 30 && e.clientX < rect.right - 40) this.startDrag(e, rect);
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
			this.dom.viewer.style.left = `${e.clientX - this.state.dragStartX}px`;
			this.dom.viewer.style.top = `${e.clientY - this.state.dragStartY}px`;
			return;
		}
		if (this.state.isResizing) {
			const res = calculateResize(e, this.state.dragStartX, this.state.dragStartY, this.state.resizeStartW, this.state.resizeStartH, this.state.resizeCorner);
			this.dom.viewer.style.width = `${res.width}px`;
			this.dom.viewer.style.height = `${res.height}px`;
			if (res.left !== undefined) this.dom.viewer.style.left = `${res.left}px`;
			if (res.top !== undefined) this.dom.viewer.style.top = `${res.top}px`;
			this.dom.img.style.width = this.dom.video.style.width = '100%';
			this.dom.img.style.height = this.dom.video.style.height = '100%';
			this.dom.img.style.objectFit = this.dom.video.style.objectFit = 'contain';
			return;
		}
		if (this.state.isPinned) this.updateCursor(e);
	}

	private handleMouseUp() {
		this.state.isDragging = false;
		this.state.isResizing = false;
		this.dom?.viewer.classList.remove('dragging', 'resizing');
	}

	private updateCursor(e: MouseEvent) {
		if (!this.dom) return;
		this.dom.viewer.style.cursor = getCursorStyle(e, this.dom.viewer.getBoundingClientRect());
	}
}
