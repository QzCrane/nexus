// goal: Scroll engine with queue system (based on gblazex/smoothscroll)
// inv: Single animation loop processes queue, prevents jumping

import type { EasingType } from './types';

export interface ScrollCommand {
	x: number;
	y: number;
	lastX: number;
	lastY: number;
	start: number;
}

interface EngineState {
	que: ScrollCommand[];
	pending: number | null;
	target: Element | Window | null;
	direction: { x: number; y: number };
	lastScroll: number;
	animationTime: number;
	easing: EasingType;
}

const state: EngineState = {
	que: [],
	pending: null,
	target: null,
	direction: { x: 0, y: 0 },
	lastScroll: 0,
	animationTime: 400,
	easing: 'spring', // Default to spring
};

export function configure(animationTime: number, easing: EasingType): void {
	state.animationTime = animationTime;
	state.easing = easing;
}

// Easing functions (Premium/Luxury Curves)
function getEasedPosition(t: number): number {
	switch (state.easing) {
		case 'linear':
			return t;
		case 'ease':
			// InOutCubic: Sharper acceleration/deceleration than Quad
			return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		case 'ease-out':
			// OutQuint: Initial fast step with extremely long, viscous tail (Silky)
			return 1 - Math.pow(1 - t, 5);
		case 'spring':
			// OutExpo: Mimics friction-based physics decay (Apple-style)
			// Much smoother than Quartic, feels "alive"
			return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
		default:
			// Fallback to OutCubic
			return 1 - Math.pow(1 - t, 3);
	}
}

function directionCheck(x: number, y: number): void {
	const dirX = x > 0 ? 1 : -1;
	const dirY = y > 0 ? 1 : -1;
	if (state.direction.x !== dirX || state.direction.y !== dirY) {
		state.direction.x = dirX;
		state.direction.y = dirY;
		// Direction changed: clear queue to prevent jumping
		state.que = [];
		state.lastScroll = 0;
		if (state.pending) {
			cancelAnimationFrame(state.pending);
			state.pending = null;
		}
	}
}

function scrollStep(): void {
	const target = state.target;
	if (!target) return;

	const now = Date.now();
	let scrollX = 0;
	let scrollY = 0;

	for (let i = 0; i < state.que.length; i++) {
		const item = state.que[i]!;
		const elapsed = now - item.start;
		const finished = elapsed >= state.animationTime;

		// Progress: [0, 1]
		const rawPosition = finished ? 1 : elapsed / state.animationTime;
		const position = getEasedPosition(rawPosition);

		// Differential scroll (only the increment)
		const x = ((item.x * position - item.lastX) | 0);
		const y = ((item.y * position - item.lastY) | 0);

		scrollX += x;
		scrollY += y;

		// Update last values
		item.lastX += x;
		item.lastY += y;

		// Remove finished items
		if (finished) {
			state.que.splice(i, 1);
			i--;
		}
	}

	// Apply scroll
	if (target instanceof Window) {
		if (scrollX || scrollY) window.scrollBy(scrollX, scrollY);
	} else {
		if (scrollX) target.scrollLeft += scrollX;
		if (scrollY) target.scrollTop += scrollY;
	}

	// Continue or finish
	if (state.que.length) {
		state.pending = requestAnimationFrame(scrollStep);
	} else {
		state.pending = null;
	}
}

/**
 * Push scroll command to queue
 */
export function scrollTo(target: Element | Window, deltaX: number, deltaY: number): void {
	directionCheck(deltaX, deltaY);

	state.target = target;

	// Push command to queue
	state.que.push({
		x: deltaX,
		y: deltaY,
		lastX: deltaX < 0 ? 0.99 : -0.99,
		lastY: deltaY < 0 ? 0.99 : -0.99,
		start: Date.now(),
	});

	// Start animation loop if not running
	if (!state.pending) {
		state.pending = requestAnimationFrame(scrollStep);
	}
}

/**
 * Clear all pending scrolls
 */
export function clearQueue(): void {
	state.que = [];
	if (state.pending) {
		cancelAnimationFrame(state.pending);
		state.pending = null;
	}
}
