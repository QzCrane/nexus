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
	const { overflowY } = getComputedStyle(el);
	if (overflowY === 'hidden' || overflowY === 'visible') return false;
	const isScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
	return isScrollStyle && el.scrollHeight > el.clientHeight + 10;
}

/**
 * Find nearest scrollable ancestor (with caching)
 */
export function findScrollTarget(el: Element | null): Element | Window {
	const startEl = el;
	while (el && el !== document.body && el !== document.documentElement) {
		const cached = cache.get(el);
		if (cached) return cached;
		if (isScrollable(el)) {
			if (startEl) cache.set(startEl, el);
			return el;
		}
		el = el.parentElement;
	}
	const result = window;
	if (startEl) cache.set(startEl, result);
	return result;
}

/**
 * Find scroll target with scroll chaining support
 */
export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	let depth = 0;

	while (current && depth < 20) {
		const target = findScrollTarget(current);
		if (target instanceof Window) return target;

		if (canScrollBy(target, deltaY)) return target;


		// rule: Trap logic - if the user is hovering a scrollable container (even if currently at edge), we MUST trap the event
		// to prevent the background body from scrolling unexpectedly.
		// Native behavior does this for 'contain', we extend it to Fixed/Sticky modals.
		// rule: Respect 'overscroll-behavior'
		const style = getComputedStyle(target);
		const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;

		if (overscroll === 'contain' || overscroll === 'none') return target;

		// rule: Trap logic - if a scrollable container is visually "modal" (Fixed/Absolute)
		// we should strictly contain the scroll to prevent body bleeding, as this is the standard UX pattern.
		// note: Bilibili favorite modal structure: wrapper(fixed) > list(static/relative) -> offsetParent check handles wrapper
		const isFloating = style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute'
			|| (target as HTMLElement).offsetParent === null // Fixed elements often have null offsetParent in some contexts
			|| getComputedStyle((target as HTMLElement).offsetParent || document.body).position === 'fixed';

		const isExplicitlyScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';

		if (isFloating && isExplicitlyScrollable) return target;

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
