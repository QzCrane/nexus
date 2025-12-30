// goal: Smooth Scroll content script injection (full feature parity)
// Supports nested scrollable containers

const LOG_TAG = '[HALO:Scroll]';

// ===== TYPES =====
interface SmoothScrollSettings {
	enabled: boolean;
	stepSize: number;
	animationTime: number;
	accelerationMax: number;
	accelerationDelta: number;
	pulseScale: number;
	arrowKeyStep: number;
	mouseWheel: boolean;
	keyboard: boolean;
	touchpad: boolean;
	middleClickAutoScroll: boolean;
	fixedBackground: boolean;
	easing: string;
}

// ===== STATE =====
let settings: SmoothScrollSettings = {
	enabled: true,
	stepSize: 300,
	animationTime: 600,
	accelerationMax: 3,
	accelerationDelta: 50,
	pulseScale: 1,
	arrowKeyStep: 200,
	mouseWheel: true,
	keyboard: true,
	touchpad: true,
	middleClickAutoScroll: true,
	fixedBackground: false,
	easing: 'spring',
};

// Animation state per element (WeakMap to avoid memory leaks)
const animationIds = new WeakMap<Element | Window, number>();
let lastScrollTime = 0;
let scrollAcceleration = 1;
let isMiddleScrolling = false;
let middleScrollStartY = 0;
let middleScrollOriginY = 0;
let middleScrollTarget: Element | Window | null = null;

// ===== UTILITIES =====
/**
 * Find the nearest scrollable ancestor of an element
 */
function getScrollableAncestor(el: Element | null): Element | Window {
	while (el && el !== document.body && el !== document.documentElement) {
		const style = getComputedStyle(el);
		const overflowY = style.overflowY;
		// Check if element is scrollable
		if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
			return el;
		}
		el = el.parentElement;
	}
	// Default to window (document scroll)
	return window;
}

/**
 * Get current scroll position of target
 */
function getScrollY(target: Element | Window): number {
	return target instanceof Window ? target.scrollY : target.scrollTop;
}

/**
 * Get max scroll position of target
 */
function getMaxScroll(target: Element | Window): number {
	if (target instanceof Window) {
		return document.documentElement.scrollHeight - window.innerHeight;
	}
	return target.scrollHeight - target.clientHeight;
}

/**
 * Set scroll position of target
 */
function setScrollY(target: Element | Window, y: number): void {
	if (target instanceof Window) {
		target.scrollTo(0, y);
	} else {
		target.scrollTop = y;
	}
}

// ===== EASING =====
function getEasing(t: number): number {
	switch (settings.easing) {
		case 'linear': return t;
		case 'ease': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
		case 'ease-out': return 1 - Math.pow(1 - t, 3);
		case 'spring': return 1 - Math.pow(1 - t, 4) * Math.cos(t * Math.PI * 0.5);
		default: return 1 - Math.pow(1 - t, 3);
	}
}

// ===== CORE SCROLL =====
function smoothScrollTo(target: Element | Window, targetY: number): void {
	if (!settings.enabled) return;

	const startY = getScrollY(target);
	const distance = targetY - startY;
	if (Math.abs(distance) < 1) return;

	const duration = settings.animationTime;
	const startTime = performance.now();

	// Cancel previous animation on this target
	const prevId = animationIds.get(target);
	if (prevId) cancelAnimationFrame(prevId);

	function animate(currentTime: number): void {
		const elapsed = currentTime - startTime;
		const progress = Math.min(elapsed / duration, 1);
		const eased = getEasing(progress);

		setScrollY(target, startY + distance * eased);

		if (progress < 1) {
			animationIds.set(target, requestAnimationFrame(animate));
		} else {
			animationIds.delete(target);
		}
	}

	animationIds.set(target, requestAnimationFrame(animate));
}

// ===== WHEEL HANDLER =====
function onWheel(e: WheelEvent): void {
	if (!settings.enabled || !settings.mouseWheel) return;

	// Touchpad detection (small delta + pixel mode)
	const isTouchpad = Math.abs(e.deltaY) < 50 && e.deltaMode === 0;
	if (isTouchpad && !settings.touchpad) return;

	// Find scrollable target
	const scrollTarget = getScrollableAncestor(e.target as Element);

	// Check if target can scroll
	const maxScroll = getMaxScroll(scrollTarget);
	if (maxScroll <= 0) return; // Not scrollable, let browser handle

	e.preventDefault();

	// Acceleration
	const now = performance.now();
	if (now - lastScrollTime < settings.accelerationDelta) {
		scrollAcceleration = Math.min(scrollAcceleration + 0.5, settings.accelerationMax);
	} else {
		scrollAcceleration = 1;
	}
	lastScrollTime = now;

	// Pulse effect
	const pulse = 1 + (scrollAcceleration - 1) / settings.pulseScale;
	const deltaY = (e.deltaY > 0 ? 1 : -1) * settings.stepSize * scrollAcceleration * pulse;

	const currentY = getScrollY(scrollTarget);
	const targetY = Math.max(0, Math.min(maxScroll, currentY + deltaY));
	smoothScrollTo(scrollTarget, targetY);
}

// ===== KEYBOARD HANDLER =====
function onKeydown(e: KeyboardEvent): void {
	if (!settings.enabled || !settings.keyboard) return;

	const target = e.target as HTMLElement;
	if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

	// Find scrollable target (document.activeElement or focused element)
	const scrollTarget = getScrollableAncestor(document.activeElement as Element);
	const maxScroll = getMaxScroll(scrollTarget);

	let deltaY = 0;
	const pageHeight = window.innerHeight * 0.9;

	switch (e.key) {
		case 'ArrowDown': deltaY = settings.arrowKeyStep; break;
		case 'ArrowUp': deltaY = -settings.arrowKeyStep; break;
		case 'PageDown': case ' ': deltaY = pageHeight; break;
		case 'PageUp': deltaY = -pageHeight; break;
		case 'Home': smoothScrollTo(scrollTarget, 0); e.preventDefault(); return;
		case 'End': smoothScrollTo(scrollTarget, maxScroll); e.preventDefault(); return;
		default: return;
	}

	e.preventDefault();
	const currentY = getScrollY(scrollTarget);
	const targetY = Math.max(0, Math.min(maxScroll, currentY + deltaY));
	smoothScrollTo(scrollTarget, targetY);
}

// ===== MIDDLE CLICK AUTO-SCROLL =====
function onMiddleDown(e: MouseEvent): void {
	if (!settings.enabled || !settings.middleClickAutoScroll) return;
	if (e.button !== 1) return;

	// Find scrollable target under cursor
	middleScrollTarget = getScrollableAncestor(e.target as Element);
	const maxScroll = getMaxScroll(middleScrollTarget);
	if (maxScroll <= 0) return; // Not scrollable

	e.preventDefault();
	isMiddleScrolling = true;
	middleScrollStartY = e.clientY;
	middleScrollOriginY = getScrollY(middleScrollTarget);
	document.body.style.cursor = 'ns-resize';
}

function onMiddleMove(e: MouseEvent): void {
	if (!isMiddleScrolling || !middleScrollTarget) return;

	const deltaY = (e.clientY - middleScrollStartY) * 2;
	const maxScroll = getMaxScroll(middleScrollTarget);
	const targetY = Math.max(0, Math.min(maxScroll, middleScrollOriginY + deltaY));
	setScrollY(middleScrollTarget, targetY);
}

function onMiddleUp(e: MouseEvent): void {
	if (e.button === 1 && isMiddleScrolling) {
		isMiddleScrolling = false;
		middleScrollTarget = null;
		document.body.style.cursor = '';
	}
}

// ===== PUBLIC API =====
export function updateSettings(newSettings: SmoothScrollSettings): void {
	const wasEnabled = settings.enabled;
	settings = newSettings;

	if (newSettings.enabled && !wasEnabled) {
		attachListeners();
	} else if (!newSettings.enabled && wasEnabled) {
		detachListeners();
	}

	console.log(LOG_TAG, 'Settings updated:', newSettings.enabled ? 'ON' : 'OFF');
}

export function attachListeners(): void {
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMiddleDown);
	window.addEventListener('mousemove', onMiddleMove);
	window.addEventListener('mouseup', onMiddleUp);
	console.log(LOG_TAG, 'Listeners attached');
}

export function detachListeners(): void {
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMiddleDown);
	window.removeEventListener('mousemove', onMiddleMove);
	window.removeEventListener('mouseup', onMiddleUp);
	console.log(LOG_TAG, 'Listeners detached');
}

export async function init(): Promise<void> {
	try {
		const result = await chrome.storage.sync.get(['HALO_SMOOTH_SCROLL_SETTINGS']);
		if (result.HALO_SMOOTH_SCROLL_SETTINGS) {
			settings = result.HALO_SMOOTH_SCROLL_SETTINGS;
		}
	} catch {
		console.log(LOG_TAG, 'Using default settings');
	}

	if (settings.enabled) {
		attachListeners();
	}

	// Listen for setting changes
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) {
			updateSettings(changes.HALO_SMOOTH_SCROLL_SETTINGS.newValue);
		}
	});

	console.log(LOG_TAG, 'Initialized');
}
