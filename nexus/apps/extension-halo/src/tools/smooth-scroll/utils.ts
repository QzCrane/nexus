// goal: Scroll utilities - target finding and caching

/**
 * Check if element has scrollable overflow
 */
function isScrollable(el: Element): boolean {
	const style = getComputedStyle(el);
	const { overflowY } = style;
	if (overflowY === 'hidden' || overflowY === 'visible') return false;
	const isScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
	return isScrollStyle && el.scrollHeight > el.clientHeight + 1;
}

/**
 * Find nearest scrollable ancestor (with caching)
 * note: strictly finds scrollable capability, does not judge context
 */
// Element cache (cleared after scroll session)
let cache = new WeakMap<Element, Element | Window>();
let clearCacheTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleClearCache(): void {
	if (clearCacheTimer) clearTimeout(clearCacheTimer);
	clearCacheTimer = setTimeout(() => {
		cache = new WeakMap();
	}, 1000);
}

export function findScrollTarget(el: Element | null): Element | Window {
	const startEl = el;
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
 * Check if an element serves as a "Blocking Barrier" that should prevent scroll bubbling
 * e.g. Fixed Modals, Sidebars, Sticky Panels of significant size
 */
function isBlockingBarrier(el: Element): boolean {
	const style = getComputedStyle(el);

	// rule: Must be out-of-flow or sticky to be a candidate
	if (style.position !== 'fixed' && style.position !== 'sticky') return false;

	// rule: Size Heuristic
	// If it's small (like a Header or FAB), it is NOT a barrier.
	// We use a threshold of 150px height or 50% width to assume "Content Container".
	const rect = el.getBoundingClientRect();
	// Barrier if tall enough (Sidebar/Modal) OR wide enough (Full Overlay) but NOT short (Header)
	// Headers are usually < 100px.
	const isHeaderLike = rect.height < 150 && rect.width > 300;
	if (isHeaderLike) return false;

	return true;
}

/**
 * Find scroll target with robust bubbling prevention
 */
export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	let depth = 0;

	while (current && depth < 20) {
		const target = findScrollTarget(current);

		// rule: Path Verification
		// Before we accept 'target' (especially if it jumped up to Window),
		// we must verify we didn't walk through a solid wall (Barrier).
		// If we did, we hit the wall.
		let walker: Element | null = current;
		const endNode = target instanceof Window ? document.body : target;
		let barrier: Element | null = null;

		while (walker && walker !== endNode && walker !== document.documentElement) {
			if (isBlockingBarrier(walker)) {
				barrier = walker;
				break;
			}
			walker = walker.parentElement;
		}

		if (barrier) {
			// We hit a barrier before reaching the proposed target.
			// The barrier IS the dead end.
			return barrier;
		}

		// rule: If valid window found and no barrier
		if (target instanceof Window) return target;

		// rule: If target is scrollable, use it
		if (canScrollBy(target, deltaY)) return target;

		// rule: Target at edge. Should we trap?

		// 1. CSS Containment
		const style = getComputedStyle(target);
		const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;
		if (overscroll === 'contain' || overscroll === 'none') return target;

		// 2. Significant Component (Large Scrollable Areas like Chat/Code)
		// Even if not Fixed, a large scrollable area usually implies localized context.
		// Heuristic: > 200px height.
		if (target.clientHeight > 200) return target;

		// 3. Is the target itself a Barrier? (e.g. Scrollable Fixed Sidebar)
		if (isBlockingBarrier(target)) return target;

		// Chain to parent
		current = (target as HTMLElement).parentElement;
		depth++;
	}
	return window;
}

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

const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'VIDEO', 'AUDIO', 'BUTTON', 'IFRAME']);
const IGNORE_ROLES = new Set(['textbox', 'listbox', 'menu', 'slider', 'switch']);

export function shouldIgnoreInput(activeElement: Element | null): boolean {
	if (!activeElement) return false;

	let current = activeElement;
	while (current.shadowRoot?.activeElement) current = current.shadowRoot.activeElement;

	const { tagName, isContentEditable } = current as HTMLElement;
	if (isContentEditable) return true;
	if (IGNORE_TAGS.has(tagName)) return true;

	const role = current.getAttribute('role');
	if (role && IGNORE_ROLES.has(role)) return true;

	if (current !== document.body && current !== document.documentElement && current.querySelector('video, audio')) return true;

	return false;
}
