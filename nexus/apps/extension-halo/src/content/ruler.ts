// goal: Ruler tool content script module

const LOG_TAG = '[HALO:Ruler]';

let overlay: HTMLDivElement | null = null;
let box: HTMLDivElement | null = null;
let startX = 0;
let startY = 0;
let isDragging = false;
let activeOperationId: string | null = null;

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
	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
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

let rafId: number | null = null;
function onMouseMove(e: MouseEvent): void {
	if (!isDragging || !box) return;

	// eff: decouple input rate from frame rate
	if (rafId) return;

	rafId = requestAnimationFrame(() => {
		if (!isDragging || !box) { rafId = null; return; }
		const x = Math.min(startX, e.clientX);
		const y = Math.min(startY, e.clientY);
		const w = Math.abs(e.clientX - startX);
		const h = Math.abs(e.clientY - startY);

		// eff: batch style updates
		const s = box.style;
		s.left = `${x}px`;
		s.top = `${y}px`;
		s.width = `${w}px`;
		s.height = `${h}px`;

		rafId = null;
	});
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

	if (activeOperationId) chrome.runtime.sendMessage({ type: 'HALO_RULER_RESULT', operationId: activeOperationId, data: result });
	removeOverlay();
	activeOperationId = null;
}

function onKeyDown(e: KeyboardEvent): void {
	if (e.key === 'Escape') {
		cancel();
	}
}

export function start(operationId: string): void {
	activeOperationId = operationId;
	createOverlay();
	console.log(LOG_TAG, 'Started');
}

export function cancel(): void {
	removeOverlay();
	activeOperationId = null;
	console.log(LOG_TAG, 'Cancelled');
}
