// goal: Scroll engine with queue system
// eff: Zero-alloc hot loop, bitwise truncations

import type { EasingType } from './types';

export interface ScrollCommand {
	x: number; y: number;
	lastX: number; lastY: number;
	start: number;
}

const state = {
	que: [] as ScrollCommand[],
	pending: 0, // Using 0 instead of null for number type stability
	target: null as Element | Window | null,
	dirX: 0, dirY: 0, // Flattened direction
	time: 400,
	easing: 'spring' as EasingType,
};

export function configure(time: number, easing: EasingType): void {
	state.time = time;
	state.easing = easing;
}

// eff: Branchless or direct math
function getEased(t: number): number {
	if (state.easing === 'spring') return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
	if (state.easing === 'ease-out') return 1 - Math.pow(1 - t, 5);
	if (state.easing === 'ease') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	return t === 1 ? 1 : t; // linear fallback
}

function processStep(): void {
	const { target, que, time } = state;
	if (!target || !que.length) {
		state.pending = 0;
		return;
	}

	const now = Date.now();
	let sx = 0, sy = 0;

	// eff: Reverse loop allows O(1) removal if order didn't matter, but it does.
	// Using standard loop with index adjustment for stability.
	// eff: compact array in-place to avoid splice allocation
	let active = 0;
	for (let i = 0; i < que.length; i++) {
		const item = que[i]!;
		const elapsed = now - item.start;
		const finished = elapsed >= time;

		// Progress [0, 1]
		const pos = finished ? 1 : getEased(elapsed / time);

		// Differential scroll (only increment)
		const dx = (item.x * pos - item.lastX) | 0;
		const dy = (item.y * pos - item.lastY) | 0;

		sx += dx; sy += dy;
		item.lastX += dx; item.lastY += dy;

		if (!finished) {
			if (i !== active) que[active] = item;
			active++;
		}
	}
	que.length = active;

	if (target instanceof Window) {
		(sx || sy) && window.scrollBy(sx, sy);
	} else {
		sx && (target.scrollLeft += sx);
		sy && (target.scrollTop += sy);
	}

	state.pending = que.length ? requestAnimationFrame(processStep) : 0;
}

export function scrollTo(target: Element | Window, x: number, y: number): void {
	// Direction Check Inline
	const dx = Math.sign(x), dy = Math.sign(y);
	if (state.dirX !== dx || state.dirY !== dy) {
		state.dirX = dx; state.dirY = dy;
		state.que.length = 0; // eff: Fast clear
		if (state.pending) cancelAnimationFrame(state.pending);
		state.pending = 0;
	}

	state.target = target;
	state.que.push({
		x, y,
		lastX: x < 0 ? 0.99 : -0.99, // Sub-pixel compensation
		lastY: y < 0 ? 0.99 : -0.99,
		start: Date.now(),
	});

	if (!state.pending) state.pending = requestAnimationFrame(processStep);
}

export function clearQueue(): void {
	state.que.length = 0;
	if (state.pending) cancelAnimationFrame(state.pending);
	state.pending = 0;
}
