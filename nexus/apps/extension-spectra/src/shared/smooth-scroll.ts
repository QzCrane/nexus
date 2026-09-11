// goal: Popup/Options smooth scroll with boundary bubbling (based on Halo sidepanel-init)
// inv: when child element reaches scroll boundary, scroll propagates to parent
// inv: reduced-motion preference disables and cancels the custom rAF scroll engine

type EasingFn = (t: number) => number;
type ScrollRoot = Document | HTMLElement;

// ===== Scroll Engine (queue-based) =====
interface ScrollCommand {
	x: number;
	y: number;
	lastX: number;
	lastY: number;
	start: number;
}

interface EngineState {
	que: ScrollCommand[];
	pending: number | null;
	target: Element | null;
	direction: { x: number; y: number };
	animationTime: number;
	easing: EasingFn;
}

interface RootBinding {
	query: MediaQueryList | null;
	onPreferenceChange: ((event: MediaQueryListEvent) => void) | null;
	wheelAttached: boolean;
}

const engine: EngineState = {
	que: [], pending: null, target: null, direction: { x: 0, y: 0 },
	animationTime: 300, easing: (t) => 1 - (1 - t) ** 4
};
const rootBindings = new WeakMap<ScrollRoot, RootBinding>();

function cancelPendingScroll(): void {
	if (engine.pending !== null) cancelAnimationFrame(engine.pending);
	engine.pending = null;
	engine.que.length = 0;
	engine.target = null;
}

function directionCheck(x: number, y: number): void {
	const dx = Math.sign(x);
	const dy = Math.sign(y);
	if (engine.direction.x !== dx || engine.direction.y !== dy) {
		engine.direction.x = dx; engine.direction.y = dy;
		engine.que.length = 0; // eff: clear without alloc
		if (engine.pending !== null) { cancelAnimationFrame(engine.pending); engine.pending = null; }
	}
}

function scrollStep(): void {
	const tgt = engine.target as HTMLElement;
	if (!tgt) return;

	const now = Date.now();
	let sy = 0;
	let active = 0;

	for (let i = 0; i < engine.que.length; i++) {
		const item = engine.que[i];
		if (!item) continue;

		const elap = now - item.start;
		const fin = elap >= engine.animationTime;
		const pos = engine.easing(fin ? 1 : elap / engine.animationTime);
		const y = ((item.y * pos - item.lastY) | 0);

		sy += y;
		item.lastY += y;

		if (!fin) {
			// eff: compact array in-place
			if (i !== active) engine.que[active] = item;
			active++;
		}
	}
	engine.que.length = active; // eff: trim

	if (sy) tgt.scrollTop += sy;

	if (engine.que.length) engine.pending = requestAnimationFrame(scrollStep);
	else engine.pending = null;
}

function scrollTo(target: Element, deltaY: number): void {
	directionCheck(0, deltaY);
	engine.target = target;
	engine.que.push({
		x: 0,
		y: deltaY,
		lastX: 0,
		lastY: deltaY < 0 ? 0.99 : -0.99,
		start: Date.now(),
	});
	if (engine.pending === null) {
		engine.pending = requestAnimationFrame(scrollStep);
	}
}

// ===== Scroll Target with Boundary Bubbling =====
function findScrollable(el: HTMLElement | null): HTMLElement {
	while (el && el !== document.body) {
		const s = getComputedStyle(el);
		if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
			return el;
		}
		el = el.parentElement;
	}
	return document.documentElement;
}

// ===== Wheel Handler with Boundary Bubbling =====
const CONFIG = {
	stepSize: 150, // more responsive than 300
	accelerationMax: 2.5,
	accelerationDelta: 50,
};

let lastTime = 0;
let accel = 1;

function handleWheel(e: WheelEvent): void {
	let target = findScrollable(e.target as HTMLElement);
	const isScrollingDown = e.deltaY > 0;
	const isScrollingUp = e.deltaY < 0;

	// Boundary bubbling: find a scrollable parent that isn't at boundary
	while (target && target !== document.documentElement) {
		const max = target.scrollHeight - target.clientHeight;
		if (max <= 0) {
			target = findScrollable(target.parentElement);
			continue;
		}

		const atTop = target.scrollTop <= 0;
		const atBottom = target.scrollTop >= max - 1;

		if ((atTop && isScrollingUp) || (atBottom && isScrollingDown)) {
			target = findScrollable(target.parentElement);
			continue;
		}

		break;
	}

	// Final boundary check
	const max = target.scrollHeight - target.clientHeight;
	if (max <= 0) return;

	const atTop = target.scrollTop <= 0;
	const atBottom = target.scrollTop >= max - 1;
	if ((atTop && isScrollingUp) || (atBottom && isScrollingDown)) {
		return; // let browser handle
	}

	e.preventDefault();

	// Acceleration
	const now = Date.now();
	if (now - lastTime < CONFIG.accelerationDelta) {
		accel = Math.min(accel + 0.4, CONFIG.accelerationMax);
	} else {
		accel = 1;
	}
	lastTime = now;

	const deltaY = (e.deltaY > 0 ? 1 : -1) * CONFIG.stepSize * accel;
	scrollTo(target, deltaY);
}

function attachWheel(root: ScrollRoot, binding: RootBinding): void {
	if (binding.wheelAttached) return;
	root.addEventListener('wheel', handleWheel as EventListener, { passive: false });
	binding.wheelAttached = true;
}

function detachWheel(root: ScrollRoot, binding: RootBinding): void {
	if (!binding.wheelAttached) return;
	root.removeEventListener('wheel', handleWheel as EventListener);
	binding.wheelAttached = false;
}

function applyMotionPreference(root: ScrollRoot, binding: RootBinding): void {
	if (binding.query?.matches) {
		detachWheel(root, binding);
		cancelPendingScroll();
		return;
	}
	attachWheel(root, binding);
}

// ===== Export =====
export function enableSmoothScroll(root: ScrollRoot = document): void {
	if (rootBindings.has(root)) return;
	const query = typeof matchMedia === 'function'
		? matchMedia('(prefers-reduced-motion: reduce)')
		: null;
	const binding: RootBinding = {
		query,
		onPreferenceChange: null,
		wheelAttached: false,
	};
	if (query) {
		binding.onPreferenceChange = () => applyMotionPreference(root, binding);
		query.addEventListener('change', binding.onPreferenceChange);
	}
	rootBindings.set(root, binding);
	applyMotionPreference(root, binding);
}

export function disableSmoothScroll(root: ScrollRoot = document): void {
	const binding = rootBindings.get(root);
	if (binding) {
		detachWheel(root, binding);
		if (binding.query && binding.onPreferenceChange) {
			binding.query.removeEventListener('change', binding.onPreferenceChange);
		}
		rootBindings.delete(root);
	} else {
		root.removeEventListener('wheel', handleWheel as EventListener);
	}
	cancelPendingScroll();
}
