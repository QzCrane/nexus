// goal: Scroll utilities - target finding and caching
let cache = new WeakMap<Element, Element | Window>();
let clearCacheTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleClearCache(): void {
	if (clearCacheTimer) clearTimeout(clearCacheTimer);
	clearCacheTimer = setTimeout(() => cache = new WeakMap(), 1000);
}

function isScrollable(el: Element): boolean {
	const { overflowY } = getComputedStyle(el);
	if (overflowY === 'visible') return false;
	const isScrollStyle = ['auto', 'scroll', 'overlay'].includes(overflowY);
	if (isScrollStyle && el.scrollHeight > el.clientHeight + 10) return true;
	if (overflowY === 'hidden' && el.clientHeight > 150) {
		if (el.scrollHeight > el.clientHeight + 50) return true;
		const cls = String(el.className);
		if (cls.includes('list') || cls.includes('scroll') || cls.includes('wrap') || cls.includes('box')) return true;
	}
	return false;
}

export function isVirtualList(el: Element): boolean {
	const { overflowY } = getComputedStyle(el);
	if (overflowY === 'hidden' && el.clientHeight > 150) {
		const cls = String(el.className);
		return cls.includes('list') || cls.includes('scroll') || cls.includes('wrap');
	}
	return false;
}

const MODAL_height_THRESHOLD = 0.5;

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

function isTrapBarrier(el: Element): boolean {
	const style = getComputedStyle(el);
	if (style.position === 'fixed') {
		if (style.overflowY === 'auto' || style.overflowY === 'scroll') return true;
		const rect = el.getBoundingClientRect();
		if (rect.height > window.innerHeight * MODAL_height_THRESHOLD) return true;
	}
	return false;
}

export function findScrollTargetChained(startEl: Element | null, deltaY: number): Element | Window {
	let current = startEl;
	let depth = 0;
	while (current && depth < 20) {
		const target = findScrollTarget(current);
		let walker = current;
		const stopNode = target instanceof Window ? document.body : target;
		while (walker && walker !== stopNode && walker !== document.documentElement) {
			if (isTrapBarrier(walker)) return walker;
			walker = walker.parentElement as Element;
		}
		if (target instanceof Window) return target;
		if (canScrollBy(target, deltaY)) return target;
		if (isTrapBarrier(target)) return target;
		const style = getComputedStyle(target);
		const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;
		if (overscroll === 'contain' || overscroll === 'none') return target;
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
	if (deltaY > 0) return target.scrollTop < max - 0.5;
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
	// rule: Precise media check - only ignore if focused on specific player markers
	if (current !== document.body && current !== document.documentElement) {
		const cls = String(current.className).toLowerCase();
		if (cls.includes('player') || cls.includes('video-js') || cls.includes('plyr')) return true;
	}
	return false;
}

export function isSuspiciousList(el: Element): boolean {
	const cls = String(el.className).toLowerCase();

	// rule: ChatGPT main chat area or any main content should be handled by us
	// We check if it's inside <main> or has a main role, but only if it's not a known virtual list
	const isMainContent = el.closest('main') || el.getAttribute('role') === 'main' || cls.includes('main');

	// rule: Strong virtual list signatures
	const isVirtual = cls.includes('virtual') || cls.includes('v-list') ||
		cls.includes('scrollbar') || cls.includes('ps-container') ||
		cls.includes('os-host') || el.hasAttribute('data-virtuoso-scroller');

	// rule: Bilibili specific virtual lists
	const isBilibiliVirtual = cls.includes('bili-comment') || cls.includes('danmaku') ||
		cls.includes('reply-list') || cls.includes('bili-video-card');

	if (isBilibiliVirtual || (isVirtual && !isMainContent)) return true;

	// rule: Heuristic - only bypass if extremely large AND not looking like main content
	// ChatGPT can have many messages, so we use a high threshold and respect isMainContent
	if (el.childElementCount > 500 && !isMainContent) return true;

	return false;
}
