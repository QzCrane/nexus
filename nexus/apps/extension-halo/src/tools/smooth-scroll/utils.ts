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
 */
function isScrollable(el: Element): boolean {
	const style = getComputedStyle(el);
	const overflowY = style.overflowY;
	return (
		(overflowY === 'auto' || overflowY === 'scroll') &&
		el.scrollHeight > el.clientHeight + 10
	);
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

	return false;
}
