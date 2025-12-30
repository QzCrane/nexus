// goal: Ruler tool content script module

const LOG_TAG = '[HALO:Ruler]';

let overlay: HTMLDivElement | null = null;
let box: HTMLDivElement | null = null;
let startX = 0;
let startY = 0;
let isDragging = false;

function createOverlay(): void {
	if (overlay) return;

	overlay = document.createElement('div');
	overlay.id = 'halo-ruler-overlay';
	Object.assign(overlay.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '100vw',
		height: '100vh',
		zIndex: '2147483647',
		cursor: 'crosshair',
		background: 'rgba(0,0,0,0.1)',
	});

	box = document.createElement('div');
	box.id = 'halo-ruler-box';
	Object.assign(box.style, {
		position: 'absolute',
		border: '2px dashed #4a9eff',
		background: 'rgba(74,158,255,0.15)',
		display: 'none',
		pointerEvents: 'none',
	});
	overlay.appendChild(box);

	overlay.addEventListener('mousedown', onMouseDown);
	overlay.addEventListener('mousemove', onMouseMove);
	overlay.addEventListener('mouseup', onMouseUp);
	overlay.addEventListener('keydown', onKeyDown);

	document.body.appendChild(overlay);
	overlay.focus();
}

function removeOverlay(): void {
	if (overlay) {
		overlay.remove();
		overlay = null;
		box = null;
	}
	isDragging = false;
}

function onMouseDown(e: MouseEvent): void {
	startX = e.clientX;
	startY = e.clientY;
	isDragging = true;
	if (box) {
		box.style.display = 'block';
		box.style.left = `${startX}px`;
		box.style.top = `${startY}px`;
		box.style.width = '0';
		box.style.height = '0';
	}
}

function onMouseMove(e: MouseEvent): void {
	if (!isDragging || !box) return;
	const x = Math.min(startX, e.clientX);
	const y = Math.min(startY, e.clientY);
	const w = Math.abs(e.clientX - startX);
	const h = Math.abs(e.clientY - startY);
	box.style.left = `${x}px`;
	box.style.top = `${y}px`;
	box.style.width = `${w}px`;
	box.style.height = `${h}px`;
}

function onMouseUp(e: MouseEvent): void {
	if (!isDragging) return;
	isDragging = false;

	const width = Math.abs(e.clientX - startX);
	const height = Math.abs(e.clientY - startY);
	const diagonal = Math.sqrt(width * width + height * height);

	const result = {
		startX: Math.min(startX, e.clientX),
		startY: Math.min(startY, e.clientY),
		endX: Math.max(startX, e.clientX),
		endY: Math.max(startY, e.clientY),
		width: Math.round(width),
		height: Math.round(height),
		diagonal: Math.round(diagonal * 10) / 10,
	};

	chrome.runtime.sendMessage({ type: 'HALO_RULER_RESULT', data: result });
	removeOverlay();
}

function onKeyDown(e: KeyboardEvent): void {
	if (e.key === 'Escape') {
		removeOverlay();
	}
}

export function start(): void {
	createOverlay();
	console.log(LOG_TAG, 'Started');
}

export function cancel(): void {
	removeOverlay();
	console.log(LOG_TAG, 'Cancelled');
}
