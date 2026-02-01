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
	// eff: getComputedStyle is expensive, but necessary. Caller handles caching.
	const style = getComputedStyle(el);
	const { overflowY } = style;

	if (overflowY === 'hidden' || overflowY === 'visible') return false;

	const isScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
	// note: +1px buffer to avoid rounding errors
	return isScrollStyle && el.scrollHeight > el.clientHeight + 1;
}

/**
 * Find nearest scrollable ancestor (with caching)
 * note: strictly finds scrollable capability, does not judge context
 */
export function findScrollTarget(el: Element | null): Element | Window {
	const startEl = el;
	// limit: Prevent infinite loops with a reasonable depth safety, though DOM usually isn't that deep
	let depth = 0;
	while (el && el !== document.body && el !== document.documentElement && depth < 100) {
		const cached = cache.get(el);
		if (cached) return cached;

		if (isScrollable(el)) {
			if (startEl) cache.set(startEl, el);
			return el;
		}

		el = el.parentElement;
		depth++;
	}
	const result = window;
	if (startEl) cache.set(startEl, result);
	return result;
}

/**
 * Determine if an element acts as a visual barrier that should trap scrolling
 * (e.g. Modals, Sidebars, Large Lists)
 */
function isTrapContext(el: Element): boolean {
	const style = getComputedStyle(el);

	// rule: Fixed/Sticky elements create a new coordinate system/context
	// If the user interacts with them, they likely expect the scroll to stay within
	if (style.position === 'fixed' || style.position === 'sticky') return true;

	return false;
}

/**
 * Find scroll target with scroll chaining prevention (The "Trap" Logic)
 */
export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	let contextTrapped = false;

	// Phase 1: Context Detection (Are we inside a Modal/Sidebar?)
	// We walk up just to check if we are physically inside a "Fixed" container.
	// If so, we must NEVER bubble to Window/Body.
	let walker = startEl;
	while (walker && walker !== document.body) {
		if (isTrapContext(walker)) {
			contextTrapped = true;
			break;
		}
		walker = walker.parentElement;
	}

	let depth = 0;
	while (current && depth < 20) {
		const target = findScrollTarget(current);

		// rule: If we found Window (meaning no scrollable ancestor found)
		if (target instanceof Window) {
			// CRITICAL: If we are in a Trapped Context (e.g. Fixed Modal), we CANNOT return Window.
			// The Modal itself (or the element we stopped at) should consume the event to prevent Body scroll.
			if (contextTrapped) {
				// We return the highest valid element found (startEl or current) or just block it.
				// Since we know 'target' (Window) is bad, we assume the user intended to scroll the 'Context'.
				// Returning the context root (walker) would be ideal, but 'current' works as a proxy limit.
				return current;
			}
			return target;
		}

		// rule: If we can scroll the target, prioritize it immediately
		if (canScrollBy(target, deltaY)) return target;

		// rule: Chaining Prevention Logic (The "Sticky" Rule)
		// If the target cannot scroll (at edge), SHOULD we chain to parent?

		// 1. Respect CSS standards
		const style = getComputedStyle(target);
		const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;
		if (overscroll === 'contain' || overscroll === 'none') return target;

		// 2. Significant Component Trap
		// If the scrollable element is large (e.g. Danmaku List, Chat Box, Code Block), 
		// we assume it is a "Component" and should NOT bleed scroll to the page.
		// Heuristic: Height > 120px (Larger than a typical dropdown/input)
		const isSignificant = target.clientHeight > 120;
		if (isSignificant) return target;

		// 3. Fixed Context Trap
		// If we are inside a fixed modal, and this inner scroller is done, 
		// we generally do NOT want to bubble to Body.
		// (Unless there is another scrollable parent inside the modal?)
		// We loop to parent. If parent is Body, stop.
		if (contextTrapped && (target.parentElement === document.body || target.parentElement === document.documentElement)) {
			return target;
		}

		// Chain to parent (Bubbling)
		current = (target as HTMLElement).parentElement;
		depth++;
	}
	return window;
}

/**
 * Scan for the likely main scroller element (generic focus)
 */
export function findMainScrollTarget(deltaY: number): Element | Window {
	const candidates = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
	for (const el of candidates) {
		const target = findScrollTargetChained(el, deltaY);
		if (target !== window && canScrollBy(target, deltaY)) return target;
	}
	return window;
}

export function getScrollY(target: Element | Window): number {
	return target instanceof Window ? target.scrollY : target.scrollTop;
}

export function getMaxScroll(target: Element | Window): number {
	if (target instanceof Window) return document.documentElement.scrollHeight - window.innerHeight;
	return target.scrollHeight - target.clientHeight;
}

export function canScroll(target: Element | Window): boolean {
	return getMaxScroll(target) > 0;
}

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
 * Check if input should be ignored (e.g. typing in text box)
 */
const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'VIDEO', 'AUDIO', 'BUTTON', 'IFRAME']);
const IGNORE_ROLES = new Set(['textbox', 'listbox', 'menu', 'slider', 'switch']);

/**
 * Check if input should be ignored (e.g. typing in text box)
 * eff: Zero-alloc hot path
 */
export function shouldIgnoreInput(activeElement: Element | null): boolean {
	if (!activeElement) return false;

	let current = activeElement;
	while (current.shadowRoot?.activeElement) current = current.shadowRoot.activeElement;

	const { tagName, isContentEditable } = current as HTMLElement;
	if (isContentEditable) return true;
	if (IGNORE_TAGS.has(tagName)) return true;

	const role = current.getAttribute('role');
	if (role && IGNORE_ROLES.has(role)) return true;

	// Smart Video Player Detection (Expensive DOM check, strictly last)
	if (current !== document.body && current !== document.documentElement && current.querySelector('video, audio')) return true;

	return false;
}
