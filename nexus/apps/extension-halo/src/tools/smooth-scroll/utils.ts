// goal: Scroll utilities - target finding and caching

// Element cache (cleared after scroll session)
let cache = new WeakMap<Element, Element | Window>();
let clearCacheTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule cache clear after scroll session ends
 */
export function scheduleClearCache(): void {
	if (clearCacheTimer) clearTimeout(clearCacheTimer);
	clearCacheTimer = setTimeout(() => {
		cache = new WeakMap();
	}, 1000);
}

/**
 * Check if element has scrollable overflow
 * rule: 'overlay' is Chromium-specific, 'hidden' elements may be JS-scrollable
 */
function isScrollable(el: Element): boolean {
	const style = getComputedStyle(el);
	const overflowY = style.overflowY;
	const hasScrollableOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
	const hasScrollableContent = el.scrollHeight > el.clientHeight + 10;

	// rule: Strict Mode for Mouse Wheel - Ignore overflow:hidden
	// Mouse wheel should only trigger on explicit scroll containers.
	// This prevents "Phantom Targets" (Issue 2) where small hidden layout divs hijack the scroll.
	if (overflowY === 'hidden' || overflowY === 'visible') {
		return false;
	}

	return hasScrollableOverflow && hasScrollableContent;
}

/**
 * Find nearest scrollable ancestor (with caching)
 */
export function findScrollTarget(el: Element | null): Element | Window {
	const startEl = el;

	while (el && el !== document.body && el !== document.documentElement) {
		// Check cache first
		const cached = cache.get(el);
		if (cached) return cached;

		if (isScrollable(el)) {
			// Cache the result for all traversed elements
			if (startEl) cache.set(startEl, el);
			return el;
		}

		el = el.parentElement;
	}

	// Default to window
	const result = window;
	if (startEl) cache.set(startEl, result);
	return result;
}

/**
 * Find scroll target with scroll chaining support
 */
export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	// Limit depth to avoid infinite loops, though DOM is finite
	let depth = 0;

	while (current && depth < 20) {
		const target = findScrollTarget(current);
		if (target instanceof Window) return target;

		if (canScrollBy(target, deltaY)) {
			return target;
		}

		// If this target can't scroll in this direction, try its parent
		// We skip the cache lookup for the parent to ensure we traverse up
		current = (target as HTMLElement).parentElement;
		depth++;
	}

	return window;
}

/**
 * Scan for the likely main scroller element when focus is generic (body/html)
 * strategy: Probe the center of the screen to find the deepest scrollable element
 */
export function findMainScrollTarget(deltaY: number): Element | Window {
	// Probe center of screen
	const cx = window.innerWidth / 2;
	const cy = window.innerHeight / 2;

	const candidates = document.elementsFromPoint(cx, cy);

	for (const el of candidates) {
		const target = findScrollTargetChained(el, deltaY);
		if (target !== window && canScrollBy(target, deltaY)) {
			return target;
		}
	}

	// Fallback to window
	return window;
}


/**
 * Get scroll position
 */
export function getScrollY(target: Element | Window): number {
	return target instanceof Window ? target.scrollY : target.scrollTop;
}

/**
 * Get max scroll
 */
export function getMaxScroll(target: Element | Window): number {
	if (target instanceof Window) {
		return document.documentElement.scrollHeight - window.innerHeight;
	}
	return target.scrollHeight - target.clientHeight;
}

/**
 * Check if target is scrollable
 */
export function canScroll(target: Element | Window): boolean {
	return getMaxScroll(target) > 0;
}

/**
 * Check if target can scroll in specific direction
 * rule: allow 1px slop for rounding errors
 */
export function canScrollBy(target: Element | Window, deltaY: number): boolean {
	if (target instanceof Window) {
		const max = document.documentElement.scrollHeight - window.innerHeight;
		if (deltaY < 0) return window.scrollY > 0;
		if (deltaY > 0) return window.scrollY < max;
		return false;
	}

	const max = target.scrollHeight - target.clientHeight;
	if (deltaY < 0) return target.scrollTop > 0;
	if (deltaY > 0) return target.scrollTop < max - 1;
	return false;
}

/**
 * recursively check for shadow roots and determine if element is interactive
 */
export function shouldIgnoreInput(activeElement: Element | null): boolean {
	if (!activeElement) return false;

	// Drill down into shadow DOMs
	let current = activeElement;
	while (current.shadowRoot && current.shadowRoot.activeElement) {
		current = current.shadowRoot.activeElement;
	}

	const tagName = current.tagName;
	const isEditable = (current as HTMLElement).isContentEditable;
	const role = current.getAttribute('role');

	// Tags that consume keyboard events
	if (
		tagName === 'INPUT' ||
		tagName === 'TEXTAREA' ||
		tagName === 'SELECT' ||
		tagName === 'OPTION' ||
		tagName === 'VIDEO' ||
		tagName === 'AUDIO' ||
		tagName === 'BUTTON' || // Buttons sometimes use space/arrows
		tagName === 'IFRAME'    // Logic inside iframe
	) {
		return true;
	}

	// Dynamic editable content
	if (isEditable) return true;

	// ARIA roles that implies interaction
	if (role === 'textbox' || role === 'listbox' || role === 'menu' || role === 'slider' || role === 'switch') {
		return true;
	}

	// Smart Video Player Detection
	// rule: Only ignore if the SPECIFIC container has a video (e.g. YouTube player div).
	// Do NOT ignore if it is the Body/HTML (otherwise any site with a video ad stops scrolling).
	if (current !== document.body && current !== document.documentElement && current.querySelector('video, audio')) {
		return true;
	}

	return false;
}
