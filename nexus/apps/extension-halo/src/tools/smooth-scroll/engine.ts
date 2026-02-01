// goal: Scroll engine with queue system (Optimized)
// eff: Object pooling, fast math, zero allocation runtime

import type { EasingType } from './types';

// eff: Pooled command object to avoid GC
export interface ScrollCommand {
	x: number; y: number;
	lastX: number; lastY: number;
	start: number;
	active: boolean; // Pool flag
}

const POOL_SIZE = 32;
// eff: Pre-allocate pool
const pool: ScrollCommand[] = [];
for (let i = 0; i < POOL_SIZE; i++) {
	pool.push({ x: 0, y: 0, lastX: 0, lastY: 0, start: 0, active: false });
}

function getCmd(x: number, y: number): ScrollCommand | null {
	// eff: Linear scan is fast enough for small pool (32)
	for (let i = 0; i < POOL_SIZE; i++) {
		const c = pool[i];
		// Safe check for pool item
		if (c && !c.active) {
			c.x = x; c.y = y;
			c.lastX = x < 0 ? 0.99 : -0.99;
			c.lastY = y < 0 ? 0.99 : -0.99;
			c.start = Date.now();
			c.active = true;
			return c;
		}
	}
	return null; // Pool exhausted (rare, ignore new scrolls)
}

const state = {
	que: [] as ScrollCommand[], // Only refs to pool
	pending: 0,
	target: null as Element | Window | null,
	dirX: 0, dirY: 0,
	time: 400,
	easing: 'spring' as EasingType,
};

export function configure(time: number, easing: EasingType): void {
	state.time = time;
	state.easing = easing;
}

// eff: Optimized easing (Math.exp is faster than Math.pow on some V8 versions, but pre-calc constants helps)
// Spring: 1 - 2^(-10t) -> 1 - exp(-6.9314 * t)
const LOG2_10 = 6.9314718;

function getEased(t: number): number {
	// Hot path optimization
	if (state.easing === 'spring') return 1 - Math.exp(-LOG2_10 * t);
	if (state.easing === 'ease-out') { const t1 = 1 - t; return 1 - (t1 * t1 * t1 * t1 * t1); }
	if (state.easing === 'ease') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5;
	return t;
}

function processStep(): void {
	const { target, que, time } = state;
	if (!target || !que.length) {
		state.pending = 0;
		return;
	}

	const now = Date.now();
	let sx = 0, sy = 0;
	let activeCount = 0;

	// eff: Single pass, swap-remove logic would be faster but changes order.
	// Sliding window is O(N) but N is small (1-5 typically).
	// We iterate carefully to satisfy TS strictness.
	const len = que.length;
	for (let i = 0; i < len; i++) {
		const item = que[i];
		// Strict check although logic guarantees availability
		if (!item) continue;

		const elapsed = now - item.start;
		const finished = elapsed >= time;

		const pos = finished ? 1 : getEased(elapsed / time);

		// Differential scroll with integer truncation
		const dx = (item.x * pos - item.lastX) | 0;
		const dy = (item.y * pos - item.lastY) | 0;

		sx += dx; sy += dy;
		item.lastX += dx; item.lastY += dy;

		if (finished) {
			item.active = false; // Return to pool
		} else {
			// Keep in queue
			if (i !== activeCount) {
				que[activeCount] = item;
			}
			activeCount++;
		}
	}
	que.length = activeCount;

	// Apply scroll
	if (sx || sy) {
		if (target instanceof Window) {
			window.scrollBy(sx, sy);
		} else {
			if (sx) (target as HTMLElement).scrollLeft += sx;
			if (sy) (target as HTMLElement).scrollTop += sy;
		}
	}

	state.pending = que.length ? requestAnimationFrame(processStep) : 0;
}

export function scrollTo(target: Element | Window, x: number, y: number): void {
	const dx = Math.sign(x), dy = Math.sign(y);
	// Direction change -> clear queue
	if (state.dirX !== dx || state.dirY !== dy) {
		state.dirX = dx; state.dirY = dy;
		clearQueue();
	}

	state.target = target;
	const cmd = getCmd(x, y);
	if (cmd) {
		state.que.push(cmd);
		if (!state.pending) state.pending = requestAnimationFrame(processStep);
	}
}

export function clearQueue(): void {
	const len = state.que.length;
	for (let i = 0; i < len; i++) {
		const item = state.que[i];
		if (item) item.active = false;
	}
	state.que.length = 0;
	if (state.pending) cancelAnimationFrame(state.pending);
	state.pending = 0;
}
