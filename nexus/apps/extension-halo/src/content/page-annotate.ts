// goal: Page Annotate Content Script Module
// Creates a canvas overlay for drawing on the page

let isActive = false;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let toolbar: HTMLElement | null = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

interface ToolState {
	color: string;
	size: number;
	mode: 'pen' | 'highlighter' | 'eraser';
}

const state: ToolState = {
	color: '#ef4444',
	size: 3,
	mode: 'pen'
};

const Z_INDEX = 9999999;

export function start() {
	if (isActive) return;
	isActive = true;
	createCanvas();
	createToolbar();
	document.body.style.overflow = 'hidden'; // Lock scroll
}

export function stop() {
	if (!isActive) return;
	isActive = false;
	removeCanvas();
	removeToolbar();
	document.body.style.overflow = '';
}

function createCanvas() {
	canvas = document.createElement('canvas');
	canvas.style.position = 'fixed';
	canvas.style.top = '0';
	canvas.style.left = '0';
	canvas.style.width = '100vw';
	canvas.style.height = '100vh';
	canvas.style.zIndex = (Z_INDEX - 1).toString();
	canvas.style.cursor = 'crosshair';
	canvas.style.pointerEvents = 'auto'; // Block interaction with page

	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;

	document.body.appendChild(canvas);
	ctx = canvas.getContext('2d');

	if (!ctx) return;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	// Events
	canvas.addEventListener('mousedown', startDrawing);
	canvas.addEventListener('mousemove', draw);
	canvas.addEventListener('mouseup', stopDrawing);
	canvas.addEventListener('mouseout', stopDrawing);
}

function removeCanvas() {
	canvas?.remove();
	canvas = null;
	ctx = null;
}

function createToolbar() {
	const nextToolbar = document.createElement('div');
	toolbar = nextToolbar;
	nextToolbar.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #1e1e1e; padding: 8px 16px; border-radius: 8px;
        display: flex; gap: 12px; align-items: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: ${Z_INDEX}; font-family: sans-serif;
    `;

	const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#000000', '#ffffff'];

	// Color picker
	colors.forEach(c => {
		const btn = document.createElement('div');
		btn.style.cssText = `width: 20px; height: 20px; border-radius: 50%; background: ${c}; cursor: pointer; border: 2px solid ${state.color === c ? '#fff' : 'transparent'};`;
		btn.onclick = () => {
			state.color = c;
			state.mode = 'pen';
			updateToolbarUI();
		};
		nextToolbar.appendChild(btn);
	});

	// Highlighter
	const highlightBtn = createBtn('🖊️', () => { state.mode = 'highlighter'; state.color = 'rgba(255, 255, 0, 0.4)'; updateToolbarUI(); });
	nextToolbar.appendChild(highlightBtn);

	// Eraser
	const eraserBtn = createBtn('🧹', () => { state.mode = 'eraser'; updateToolbarUI(); });
	nextToolbar.appendChild(eraserBtn);

	// Close
	const closeBtn = createBtn('❌', () => { stop(); });
	closeBtn.style.marginLeft = '12px';
	nextToolbar.appendChild(closeBtn);

	document.body.appendChild(nextToolbar);
}

function createBtn(text: string, onClick: () => void) {
	const btn = document.createElement('button');
	btn.textContent = text;
	btn.style.cssText = `background: #333; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 14px;`;
	btn.onclick = onClick;
	return btn;
}

function removeToolbar() {
	toolbar?.remove();
	toolbar = null;
}

function updateToolbarUI() {
	// Ideally update borders/active state
}

function startDrawing(e: MouseEvent) {
	isDrawing = true;
	[lastX, lastY] = [e.clientX, e.clientY];
}

function draw(e: MouseEvent) {
	if (!isDrawing || !ctx) return;

	ctx.beginPath();
	ctx.moveTo(lastX, lastY);
	ctx.lineTo(e.clientX, e.clientY);

	if (state.mode === 'eraser') {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.lineWidth = 20;
	} else {
		ctx.globalCompositeOperation = 'source-over';
		ctx.strokeStyle = state.color;

		if (state.mode === 'highlighter') {
			ctx.lineWidth = 15;
			// Highlighter is actually just transparent color with source-over, 
			// but 'multiply' might be better. For simplicity, just use rgba.
		} else {
			ctx.lineWidth = state.size;
		}
	}

	ctx.stroke();
	ctx.globalCompositeOperation = 'source-over'; // Reset

	[lastX, lastY] = [e.clientX, e.clientY];
}

function stopDrawing() {
	isDrawing = false;
}
