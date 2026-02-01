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
	if (overflowY === 'visible') return false;

	const isScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

	// rule: Standard scrollable container
	if (isScrollStyle && el.scrollHeight > el.clientHeight + 10) return true;

	// rule: Virtual Lists / Custom Scrollbars often use overflow: hidden
	// Heuristic: If meaningful height (>150px) and significant overflow (>50px), treat as scrollable
	if (overflowY === 'hidden' && el.clientHeight > 150 && el.scrollHeight > el.clientHeight + 50) return true;

	return false;
}

/**
 * Find nearest scrollable ancestor (with caching)
 */
// rule: Threshold to consider a fixed element as a "Modal Overlay" (vs a Header)
// If a fixed element covers >50% of screen height, we treat it as a dedicated scroll context
const MODAL_height_THRESHOLD = 0.5;

export function findScrollTarget(el: Element | null): Element | Window {
	const startEl = el;
	while (el && el !== document.body && el !== document.documentElement) {
		const cached = cache.get(el);
		if (cached) return cached;

		// rule: Standard scrollable check
		const style = getComputedStyle(el);
		const overflowY = style.overflowY;
		if (overflowY !== 'hidden' && overflowY !== 'visible') {
			const isScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
			if (isScrollStyle && el.scrollHeight > el.clientHeight + 10) {
				if (startEl) cache.set(startEl, el);
				return el;
			}
		}

		el = el.parentElement;
	}
	const result = window;
	if (startEl) cache.set(startEl, result);
	return result;
}

function isTrapBarrier(el: Element): boolean {
	const style = getComputedStyle(el);
	if (style.position === 'fixed') {
		// rule: If explicit scrollable fixed -> Trap (Sidebars)
		if (style.overflowY === 'auto' || style.overflowY === 'scroll') return true;

		// rule: If large overlay fixed -> Trap (Modal Backdrops)
		// Small headers (height < 50% screen) are NOT traps
		const rect = el.getBoundingClientRect();
		if (rect.height > window.innerHeight * MODAL_height_THRESHOLD) return true;
	}
	// Note: We intentionally ignore 'sticky' because sticky headers usually want pass-through
	return false;
}

/**
 * Find scroll target with scroll chaining support
 */
export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	let depth = 0;

	while (current && depth < 20) {
		const target = findScrollTarget(current);

		// rule: Trap Check - Walk from current to target to ensure we don't cross a barrier (e.g. Fixed Modal Overlay)
		// If we hit a barrier, that barrier IS our effective target (and it will block scrolling if strictly constrained)
		let walker = current;
		const stopNode = target instanceof Window ? document.body : target;

		while (walker && walker !== stopNode && walker !== document.documentElement) {
			if (isTrapBarrier(walker)) return walker;
			walker = walker.parentElement as Element;
		}

		// rule: If target found
		if (target instanceof Window) return target;

		// rule: If we can scroll the target, do it.
		if (canScrollBy(target, deltaY)) return target;

		// rule: If the target itself is a barrier (e.g. scrollable modal at the edge), we are TRAPPED.
		if (isTrapBarrier(target)) return target;

		// rule: respecting overscroll-behavior (Standard CSS)
		const style = getComputedStyle(target);
		const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;
		if (overscroll === 'contain' || overscroll === 'none') return target;

		// Chain to parent
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
