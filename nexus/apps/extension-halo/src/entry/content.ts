// goal: HALO Content Script Host
// Lightweight host for content-based tools (ruler, color-picker, etc.)

const LOG_TAG = '[HALO]';
const t0 = performance.now();

console.log(LOG_TAG, 'Content script loaded at', t0.toFixed(2), 'ms');

// Track active content tools
let activeTools: Set<string> = new Set();

// ===== RULER TOOL =====
let rulerOverlay: HTMLDivElement | null = null;
let rulerBox: HTMLDivElement | null = null;
let rulerStartX = 0;
let rulerStartY = 0;
let isRulerDragging = false;

function createRulerOverlay(): void {
	if (rulerOverlay) return;

	rulerOverlay = document.createElement('div');
	rulerOverlay.id = 'halo-ruler-overlay';
	Object.assign(rulerOverlay.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '100vw',
		height: '100vh',
		zIndex: '2147483647',
		cursor: 'crosshair',
		background: 'rgba(0,0,0,0.1)',
	});

	rulerBox = document.createElement('div');
	rulerBox.id = 'halo-ruler-box';
	Object.assign(rulerBox.style, {
		position: 'absolute',
		border: '2px dashed #4a9eff',
		background: 'rgba(74,158,255,0.15)',
		display: 'none',
		pointerEvents: 'none',
	});
	rulerOverlay.appendChild(rulerBox);

	rulerOverlay.addEventListener('mousedown', onRulerMouseDown);
	rulerOverlay.addEventListener('mousemove', onRulerMouseMove);
	rulerOverlay.addEventListener('mouseup', onRulerMouseUp);
	rulerOverlay.addEventListener('keydown', onRulerKeyDown);

	document.body.appendChild(rulerOverlay);
	rulerOverlay.focus();
}

function removeRulerOverlay(): void {
	if (rulerOverlay) {
		rulerOverlay.remove();
		rulerOverlay = null;
		rulerBox = null;
	}
	isRulerDragging = false;
}

function onRulerMouseDown(e: MouseEvent): void {
	rulerStartX = e.clientX;
	rulerStartY = e.clientY;
	isRulerDragging = true;
	if (rulerBox) {
		rulerBox.style.display = 'block';
		rulerBox.style.left = `${rulerStartX}px`;
		rulerBox.style.top = `${rulerStartY}px`;
		rulerBox.style.width = '0';
		rulerBox.style.height = '0';
	}
}

function onRulerMouseMove(e: MouseEvent): void {
	if (!isRulerDragging || !rulerBox) return;
	const x = Math.min(rulerStartX, e.clientX);
	const y = Math.min(rulerStartY, e.clientY);
	const w = Math.abs(e.clientX - rulerStartX);
	const h = Math.abs(e.clientY - rulerStartY);
	rulerBox.style.left = `${x}px`;
	rulerBox.style.top = `${y}px`;
	rulerBox.style.width = `${w}px`;
	rulerBox.style.height = `${h}px`;
}

function onRulerMouseUp(e: MouseEvent): void {
	if (!isRulerDragging) return;
	isRulerDragging = false;

	const width = Math.abs(e.clientX - rulerStartX);
	const height = Math.abs(e.clientY - rulerStartY);
	const diagonal = Math.sqrt(width * width + height * height);

	const result = {
		startX: Math.min(rulerStartX, e.clientX),
		startY: Math.min(rulerStartY, e.clientY),
		endX: Math.max(rulerStartX, e.clientX),
		endY: Math.max(rulerStartY, e.clientY),
		width: Math.round(width),
		height: Math.round(height),
		diagonal: Math.round(diagonal * 10) / 10,
	};

	chrome.runtime.sendMessage({ type: 'HALO_RULER_RESULT', data: result });
	removeRulerOverlay();
}

function onRulerKeyDown(e: KeyboardEvent): void {
	if (e.key === 'Escape') {
		removeRulerOverlay();
	}
}

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'HALO_GET_STATUS':
			sendResponse({
				hostname: window.location.hostname,
				activeTools: Array.from(activeTools),
			});
			break;

		case 'HALO_TOOL_ACTIVATE':
			const toolId = message.payload?.toolId;
			if (toolId) {
				console.log(LOG_TAG, 'Tool activation requested:', toolId);
				activeTools.add(toolId);
				sendResponse({ success: true, toolId });
			} else {
				sendResponse({ success: false, error: 'Missing toolId' });
			}
			break;

		case 'HALO_TOOL_DEACTIVATE':
			const deactivateId = message.payload?.toolId;
			if (deactivateId) {
				activeTools.delete(deactivateId);
				sendResponse({ success: true });
			}
			break;

		case 'HALO_RULER_START':
			createRulerOverlay();
			sendResponse({ success: true });
			break;

		case 'HALO_RULER_CANCEL':
			removeRulerOverlay();
			sendResponse({ success: true });
			break;

		case 'HALO_SCROLL_TO_HEADING':
			const headingIndex = message.index;
			if (typeof headingIndex === 'number') {
				const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
				const target = headings[headingIndex];
				if (target) {
					target.scrollIntoView({ behavior: 'smooth', block: 'center' });
					// Highlight briefly
					const el = target as HTMLElement;
					const original = el.style.background;
					el.style.background = 'rgba(124,58,237,0.3)';
					setTimeout(() => { el.style.background = original; }, 1500);
				}
				sendResponse({ success: true });
			} else {
				sendResponse({ success: false, error: 'Missing index' });
			}
			break;

		default:
			sendResponse({ success: false, error: 'Unknown message type' });
	}
	return false;
});

console.log(LOG_TAG, 'Content script ready in', (performance.now() - t0).toFixed(2), 'ms');

