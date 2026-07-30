// goal: Structural scroll routing with explicit native and containment boundaries
// inv: Only browser-user-scrollable overflow may be animated

export type ScrollTarget = Element | Window;

const SCROLL_ADMISSION_TOKEN = Symbol('halo-scroll-admission');

export interface ScrollAdmission {
	readonly token: typeof SCROLL_ADMISSION_TOKEN;
	readonly target: ScrollTarget;
	readonly directionY: -1 | 1;
	readonly positionY: number;
	readonly capacityY: number;
}

export interface ScrollTargetMetrics {
	readonly target: ScrollTarget;
	readonly positionY: number;
	readonly maxY: number;
	readonly capacityY: number;
}

export interface ScrollTargetMetricsBuffer {
	target: ScrollTarget;
	positionY: number;
	maxY: number;
	capacityY: number;
}

export type ScrollRoute =
	| { kind: 'animate'; target: ScrollTarget; admission?: ScrollAdmission }
	| { kind: 'native' }
	| { kind: 'blocked'; target: Element };

const USER_SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);
const MEDIA_ROUTING_LEAF_TAGS = new Set(['AUDIO', 'VIDEO']);
const VIRTUAL_SCROLLER_ATTRIBUTES = ['data-virtuoso-scroller', 'data-v-scroll'];
const BLOCKED_OVERFLOW = new Set(['hidden', 'clip']);
const STRUCTURAL_NATIVE_SELECTOR = [
	'canvas',
	'embed',
	'iframe',
	'object',
	'[role="application"]',
	'[role="slider"]',
	'[role="spinbutton"]',
	'[contenteditable]:not([contenteditable="false"])',
	'input[type="range"]',
	'input[type="number"]',
	'[data-virtuoso-scroller]',
	'[data-v-scroll]',
].join(',');
export const MAX_SCROLL_ROUTE_ELEMENTS = 65;
let reducedMotionQuery: MediaQueryList | null = null;

function bodyOverflowOwnsViewport(rootStyle: CSSStyleDeclaration): boolean {
	return rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
}

function isViewportRoot(
	el: Element,
	rootStyle?: CSSStyleDeclaration,
): boolean {
	if (el === document.documentElement || el === document.scrollingElement) return true;
	return el === document.body &&
		bodyOverflowOwnsViewport(rootStyle ?? getComputedStyle(document.documentElement));
}

function shouldYieldRoutePath(
	start: Element | null,
	composedPath?: readonly EventTarget[],
): boolean {
	let first: Element | null = null;
	let previous: Element | null = null;
	let last: Element | null = null;
	let parentCursor = composedPath ? null : start;
	let pathIndex = 0;
	let elementCount = 0;
	let isCompleteLightDomPath = true;
	let includesFullscreen = false;
	const fullscreen = document.fullscreenElement;

	for (;;) {
		let current: Element | null = null;
		if (composedPath) {
			while (pathIndex < composedPath.length) {
				const candidate = composedPath[pathIndex++];
				if (candidate instanceof Element) {
					current = candidate;
					break;
				}
			}
		} else {
			current = parentCursor;
			parentCursor = current?.parentElement ?? null;
		}
		if (!current) break;
		if (current === previous) continue;
		if (!current.isConnected) return true;
		elementCount++;
		if (elementCount > MAX_SCROLL_ROUTE_ELEMENTS) return true;
		first ??= current;
		if (previous && previous.parentElement !== current) {
			isCompleteLightDomPath = false;
		}
		previous = current;
		last = current;
		if (current === fullscreen) includesFullscreen = true;
	}

	if (elementCount === 0 || includesFullscreen) return true;
	if (
		isCompleteLightDomPath &&
		last === document.documentElement &&
		first
	) {
		return (
			(first as HTMLElement).isContentEditable ||
			first.closest(STRUCTURAL_NATIVE_SELECTOR) !== null
		);
	}

	previous = null;
	parentCursor = composedPath ? null : start;
	pathIndex = 0;
	for (;;) {
		let current: Element | null = null;
		if (composedPath) {
			while (pathIndex < composedPath.length) {
				const candidate = composedPath[pathIndex++];
				if (candidate instanceof Element) {
					current = candidate;
					break;
				}
			}
		} else {
			current = parentCursor;
			parentCursor = current?.parentElement ?? null;
		}
		if (!current) break;
		if (current === previous) continue;
		previous = current;
		if (
			(current as HTMLElement).isContentEditable ||
			current.matches(STRUCTURAL_NATIVE_SELECTOR)
		) return true;
	}
	return false;
}

function isUserScrollable(el: Element, style: CSSStyleDeclaration): boolean {
	return !MEDIA_ROUTING_LEAF_TAGS.has(el.tagName) &&
		USER_SCROLLABLE_OVERFLOW.has(style.overflowY) &&
		el.scrollHeight > el.clientHeight + 1;
}

function directionalCapacity(positionY: number, maxY: number, deltaY: number): number {
	if (!deltaY) return 0;
	return deltaY < 0
		? Math.max(0, positionY)
		: Math.max(0, maxY - positionY);
}

function measureElementScroll(
	target: Element,
	deltaY: number,
	style: CSSStyleDeclaration,
): ScrollTargetMetrics | null {
	const metrics: ScrollTargetMetricsBuffer = {
		target,
		positionY: 0,
		maxY: 0,
		capacityY: 0,
	};
	return readElementScroll(target, deltaY, style, metrics)
		? metrics
		: null;
}

function readElementScroll(
	target: Element,
	deltaY: number,
	style: CSSStyleDeclaration,
	metrics: ScrollTargetMetricsBuffer,
): boolean {
	if (
		!target.isConnected ||
		MEDIA_ROUTING_LEAF_TAGS.has(target.tagName) ||
		!USER_SCROLLABLE_OVERFLOW.has(style.overflowY)
	) {
		return false;
	}
	const scrollHeight = target.scrollHeight;
	const clientHeight = target.clientHeight;
	if (scrollHeight <= clientHeight + 1) return false;
	const positionY = target.scrollTop;
	const maxY = Math.max(0, scrollHeight - clientHeight);
	metrics.target = target;
	metrics.positionY = positionY;
	metrics.maxY = maxY;
	metrics.capacityY = directionalCapacity(positionY, maxY, deltaY);
	return true;
}

function createScrollAdmission(metrics: ScrollTargetMetrics, deltaY: number): ScrollAdmission {
	return {
		token: SCROLL_ADMISSION_TOKEN,
		target: metrics.target,
		directionY: Math.sign(deltaY) as -1 | 1,
		positionY: metrics.positionY,
		capacityY: metrics.capacityY,
	};
}

export function matchesScrollAdmission(
	admission: ScrollAdmission | undefined,
	target: ScrollTarget,
	deltaY: number,
): boolean {
	return admission?.token === SCROLL_ADMISSION_TOKEN &&
		admission.target === target &&
		(target instanceof Window || target.isConnected) &&
		admission.directionY === Math.sign(deltaY) &&
		admission.capacityY > 0.5;
}

function rootScrollIsBlocked(
	rootStyle: CSSStyleDeclaration = getComputedStyle(document.documentElement),
	bodyStyle?: CSSStyleDeclaration,
): boolean {
	const viewportOverflow = bodyOverflowOwnsViewport(rootStyle) && document.body
		? (bodyStyle ?? getComputedStyle(document.body)).overflowY
		: rootStyle.overflowY;
	return BLOCKED_OVERFLOW.has(viewportOverflow);
}

function containsVirtualScrollerMarker(el: Element): boolean {
	for (const attribute of VIRTUAL_SCROLLER_ATTRIBUTES) {
		if (el.hasAttribute(attribute)) return true;
	}
	return false;
}

function isContainmentBoundary(style: CSSStyleDeclaration): boolean {
	const overscroll = style.overscrollBehaviorY || style.overscrollBehavior;
	return overscroll === 'contain' || overscroll === 'none';
}

export function shouldYieldWheel(start: Element | null): boolean {
	return shouldYieldRoutePath(start);
}

export function prefersReducedMotion(): boolean {
	reducedMotionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
	return reducedMotionQuery.matches;
}

export function resolveScrollRoute(
	start: Element | null,
	deltaY: number,
	composedPath?: readonly EventTarget[],
): ScrollRoute {
	if (!deltaY) return { kind: 'native' };
	if (shouldYieldRoutePath(start, composedPath)) return { kind: 'native' };

	let rootStyle: CSSStyleDeclaration | undefined;
	let bodyStyle: CSSStyleDeclaration | undefined;
	let previous: Element | null = null;
	let parentCursor = composedPath ? null : start;
	let pathIndex = 0;
	for (;;) {
		let current: Element | null = null;
		if (composedPath) {
			while (pathIndex < composedPath.length) {
				const candidate = composedPath[pathIndex++];
				if (candidate instanceof Element) {
					current = candidate;
					break;
				}
			}
		} else {
			current = parentCursor;
			parentCursor = current?.parentElement ?? null;
		}
		if (!current) break;
		if (current === previous) continue;
		previous = current;

		if (current === document.body) {
			rootStyle ??= getComputedStyle(document.documentElement);
		}
		if (isViewportRoot(current, rootStyle)) break;
		if (MEDIA_ROUTING_LEAF_TAGS.has(current.tagName)) continue;
		let style: CSSStyleDeclaration;
		if (current === document.body) {
			bodyStyle ??= getComputedStyle(current);
			style = bodyStyle;
		} else {
			style = getComputedStyle(current);
		}
		const metrics = measureElementScroll(current, deltaY, style);
		if (metrics && metrics.capacityY > 0.5) {
			return {
				kind: 'animate',
				target: current,
				admission: createScrollAdmission(metrics, deltaY),
			};
		}
		if (isContainmentBoundary(style)) {
			return { kind: 'blocked', target: current };
		}
	}

	rootStyle ??= getComputedStyle(document.documentElement);
	if (rootScrollIsBlocked(rootStyle, bodyStyle)) return { kind: 'native' };
	const metrics = measureScrollTarget(window, deltaY);
	return metrics && metrics.capacityY > 0.5
		? {
			kind: 'animate',
			target: window,
			admission: createScrollAdmission(metrics, deltaY),
		}
		: { kind: 'native' };
}

export function resolveDirectScrollRoute(
	start: Element | null,
	composedPath?: readonly EventTarget[],
): ScrollRoute {
	if (shouldYieldRoutePath(start, composedPath)) return { kind: 'native' };

	let rootStyle: CSSStyleDeclaration | undefined;
	let bodyStyle: CSSStyleDeclaration | undefined;
	let previous: Element | null = null;
	let parentCursor = composedPath ? null : start;
	let pathIndex = 0;
	for (;;) {
		let current: Element | null = null;
		if (composedPath) {
			while (pathIndex < composedPath.length) {
				const candidate = composedPath[pathIndex++];
				if (candidate instanceof Element) {
					current = candidate;
					break;
				}
			}
		} else {
			current = parentCursor;
			parentCursor = current?.parentElement ?? null;
		}
		if (!current) break;
		if (current === previous) continue;
		previous = current;
		if (current === document.body) {
			rootStyle ??= getComputedStyle(document.documentElement);
		}
		if (isViewportRoot(current, rootStyle)) break;
		if (MEDIA_ROUTING_LEAF_TAGS.has(current.tagName)) {
			current = current.parentElement;
			continue;
		}
		let style: CSSStyleDeclaration;
		if (current === document.body) {
			bodyStyle ??= getComputedStyle(current);
			style = bodyStyle;
		} else {
			style = getComputedStyle(current);
		}
		if (isUserScrollable(current, style)) {
			return { kind: 'animate', target: current };
		}
		if (isContainmentBoundary(style)) {
			return { kind: 'blocked', target: current };
		}
	}

	rootStyle ??= getComputedStyle(document.documentElement);
	if (rootScrollIsBlocked(rootStyle, bodyStyle)) {
		return { kind: 'native' };
	}
	return getMaxScroll(window) > 0
		? { kind: 'animate', target: window }
		: { kind: 'native' };
}

export function resolveMainScrollRoute(deltaY: number): ScrollRoute {
	const candidates = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
	for (const candidate of candidates) {
		const route = resolveScrollRoute(candidate, deltaY);
		if (route.kind === 'blocked') return route;
		if (
			route.kind === 'animate' &&
			route.target !== window
		) {
			return route;
		}
	}
	return resolveScrollRoute(document.body, deltaY);
}

export function getMaxScroll(target: ScrollTarget): number {
	const canonical = canonicalizeScrollTarget(target);
	if (canonical instanceof Window) {
		const root = document.scrollingElement || document.documentElement;
		return Math.max(0, root.scrollHeight - window.innerHeight);
	}
	return Math.max(0, canonical.scrollHeight - canonical.clientHeight);
}

function measureScrollTarget(target: ScrollTarget, deltaY: number): ScrollTargetMetrics {
	const metrics: ScrollTargetMetricsBuffer = {
		target,
		positionY: 0,
		maxY: 0,
		capacityY: 0,
	};
	readScrollTarget(target, deltaY, metrics);
	return metrics;
}

function readScrollTarget(
	target: ScrollTarget,
	deltaY: number,
	metrics: ScrollTargetMetricsBuffer,
): void {
	const canonical = canonicalizeScrollTarget(target);
	readCanonicalScrollTarget(canonical, deltaY, metrics);
}

function readCanonicalScrollTarget(
	canonical: ScrollTarget,
	deltaY: number,
	metrics: ScrollTargetMetricsBuffer,
): void {
	const positionY = canonical instanceof Window ? canonical.scrollY : canonical.scrollTop;
	const maxY = canonical instanceof Window
		? Math.max(
			0,
			(document.scrollingElement || document.documentElement).scrollHeight -
				window.innerHeight,
		)
		: Math.max(0, canonical.scrollHeight - canonical.clientHeight);
	metrics.target = canonical;
	metrics.positionY = positionY;
	metrics.maxY = maxY;
	metrics.capacityY = directionalCapacity(positionY, maxY, deltaY);
}

export function canScrollBy(target: ScrollTarget, deltaY: number): boolean {
	return measureScrollTarget(target, deltaY).capacityY > 0.5;
}

export function inspectAnimatableScrollTarget(
	target: ScrollTarget,
	deltaY: number,
): ScrollTargetMetrics | null {
	const metrics: ScrollTargetMetricsBuffer = {
		target,
		positionY: 0,
		maxY: 0,
		capacityY: 0,
	};
	return readAnimatableScrollTarget(target, deltaY, metrics)
		? metrics
		: null;
}

export function readAnimatableScrollTarget(
	target: ScrollTarget,
	deltaY: number,
	metrics: ScrollTargetMetricsBuffer,
): boolean {
	let rootStyle: CSSStyleDeclaration | undefined;
	let canonical: ScrollTarget = target;
	if (!(target instanceof Window)) {
		if (
			target === document.documentElement ||
			target === document.scrollingElement
		) {
			canonical = window;
		} else if (target === document.body) {
			rootStyle = getComputedStyle(document.documentElement);
			if (bodyOverflowOwnsViewport(rootStyle)) canonical = window;
		}
	}
	if (canonical instanceof Window) {
		rootStyle ??= getComputedStyle(document.documentElement);
		if (rootScrollIsBlocked(rootStyle)) return false;
		readCanonicalScrollTarget(canonical, deltaY, metrics);
		return true;
	}
	if (
		!canonical.isConnected ||
		containsVirtualScrollerMarker(canonical)
	) {
		return false;
	}
	return readElementScroll(
		canonical,
		deltaY,
		getComputedStyle(canonical),
		metrics,
	);
}

export function getAnimatableScrollDistance(
	target: ScrollTarget,
	deltaY: number,
): number {
	return inspectAnimatableScrollTarget(target, deltaY)?.capacityY ?? 0;
}

export function canAnimateTarget(target: ScrollTarget, deltaY: number): boolean {
	return getAnimatableScrollDistance(target, deltaY) > 0.5;
}

export function canonicalizeScrollTarget(target: ScrollTarget): ScrollTarget {
	if (target instanceof Window) return target;
	if (
		target === document.documentElement ||
		target === document.scrollingElement
	) return window;
	if (target !== document.body) return target;
	return bodyOverflowOwnsViewport(getComputedStyle(document.documentElement))
		? window
		: target;
}

const IGNORE_TAGS = new Set([
	'AUDIO',
	'BUTTON',
	'IFRAME',
	'INPUT',
	'OPTION',
	'SELECT',
	'TEXTAREA',
	'VIDEO',
]);
const IGNORE_ROLES = new Set(['listbox', 'menu', 'slider', 'switch', 'textbox']);

export function shouldIgnoreInput(activeElement: Element | null): boolean {
	if (!activeElement) return false;
	let current = activeElement;
	while (current.shadowRoot?.activeElement) current = current.shadowRoot.activeElement;
	const html = current as HTMLElement;
	if (html.isContentEditable || IGNORE_TAGS.has(current.tagName)) return true;
	const role = current.getAttribute('role');
	return role !== null && IGNORE_ROLES.has(role);
}
