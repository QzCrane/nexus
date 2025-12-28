/**
 * Smooth Scroll Engine
 * 
 * Uses requestAnimationFrame + ease-out-quart for Mac-like inertial scrolling.
 */

const CONFIG = {
	sensitivity: 0.6,
	duration: 600,
	// ease-out-quart
	easing: (t: number) => 1 - Math.pow(1 - t, 4),
};

interface ScrollState {
	container: HTMLElement | null;
	animationId: number | null;
	targetY: number;
	startY: number;
	startTime: number;
}

const state: ScrollState = {
	container: null,
	animationId: null,
	targetY: 0,
	startY: 0,
	startTime: 0,
};

function animateScroll(timestamp: number): void {
	if (!state.container) return;

	if (!state.startTime) {
		state.startTime = timestamp;
	}

	const elapsed = timestamp - state.startTime;
	const progress = Math.min(elapsed / CONFIG.duration, 1);
	const easedProgress = CONFIG.easing(progress);

	const currentY = state.startY + (state.targetY - state.startY) * easedProgress;
	state.container.scrollTop = currentY;

	if (progress < 1) {
		state.animationId = requestAnimationFrame(animateScroll);
	} else {
		state.animationId = null;
	}
}

function scrollTo(container: HTMLElement, targetY: number): void {
	if (state.animationId !== null) {
		cancelAnimationFrame(state.animationId);
	}

	const maxScroll = container.scrollHeight - container.clientHeight;
	const clampedTarget = Math.max(0, Math.min(targetY, maxScroll));

	state.container = container;
	state.startY = container.scrollTop;
	state.targetY = clampedTarget;
	state.startTime = 0;

	state.animationId = requestAnimationFrame(animateScroll);
}

function handleWheel(event: WheelEvent): void {
	const container = findScrollableParent(event.target as HTMLElement);
	if (!container) return;

	event.preventDefault();

	const delta = event.deltaY * CONFIG.sensitivity;

	const currentTarget =
		state.container === container && state.animationId !== null
			? state.targetY
			: container.scrollTop;

	scrollTo(container, currentTarget + delta);
}

function findScrollableParent(element: HTMLElement | null): HTMLElement | null {
	while (element && element !== document.body) {
		const style = getComputedStyle(element);
		const overflowY = style.overflowY;

		if (
			(overflowY === 'auto' || overflowY === 'scroll') &&
			element.scrollHeight > element.clientHeight
		) {
			return element;
		}

		element = element.parentElement;
	}

	const html = document.documentElement;
	if (html.scrollHeight > html.clientHeight) {
		return html;
	}

	return null;
}

export function enableSmoothScroll(root: Document | HTMLElement = document): void {
	root.addEventListener('wheel', handleWheel as EventListener, { passive: false });
	console.log('[SPECTRA] Smooth scroll enabled');
}

export function disableSmoothScroll(root: Document | HTMLElement = document): void {
	root.removeEventListener('wheel', handleWheel as EventListener);
	if (state.animationId !== null) {
		cancelAnimationFrame(state.animationId);
		state.animationId = null;
	}
	console.log('[SPECTRA] Smooth scroll disabled');
}
