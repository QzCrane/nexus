import { MIN_SIZE, RESIZE_HANDLE_SIZE } from './pin-constants';

export function detectCorner(e: MouseEvent, rect: DOMRect): string | null {
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

export interface ResizeResult {
	width: number;
	height: number;
	left?: number;
	top?: number;
}

export function calculateResize(
	e: MouseEvent,
	dragStartX: number,
	dragStartY: number,
	resizeStartW: number,
	resizeStartH: number,
	corner: string
): ResizeResult {
	const dx = e.clientX - dragStartX;
	const dy = e.clientY - dragStartY;

	let newW = resizeStartW;
	let newH = resizeStartH;

	if (corner.includes('e')) newW = Math.max(MIN_SIZE, resizeStartW + dx);
	if (corner.includes('w')) newW = Math.max(MIN_SIZE, resizeStartW - dx);
	if (corner.includes('s')) newH = Math.max(MIN_SIZE, resizeStartH + dy);
	if (corner.includes('n')) newH = Math.max(MIN_SIZE, resizeStartH - dy);

	const result: ResizeResult = { width: newW, height: newH };

	if (corner.includes('w')) {
		result.left = e.clientX;
	}
	if (corner.includes('n')) {
		result.top = e.clientY;
	}

	return result;
}

export function getCursorStyle(e: MouseEvent, rect: DOMRect): string {
	const corner = detectCorner(e, rect);
	if (corner === 'se' || corner === 'nw') return 'nwse-resize';
	if (corner === 'sw' || corner === 'ne') return 'nesw-resize';
	if (e.clientY < rect.top + 30 && e.clientX < rect.right - 40) return 'move';
	return '';
}
