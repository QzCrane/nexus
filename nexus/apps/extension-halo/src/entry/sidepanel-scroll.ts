// goal: SidePanel smooth scroll logic - separated for line limit compliance
// inv: Always active in sidepanel, ignores the 'enabled' setting (only for web pages)

import { clearQueue, scrollTo, configure } from '../tools/smooth-scroll/engine';
import { normalizeScrollSettings, STORAGE_KEY } from '../tools/smooth-scroll/types';
import type { EasingType } from '../tools/smooth-scroll/types';
import type { ScrollTarget } from '../tools/smooth-scroll/utils';
import {
	resolveMainScrollRoute,
	resolveScrollRoute,
	shouldIgnoreInput,
} from '../tools/smooth-scroll/utils';
import {
	classifyWheelGesture,
	createWheelGestureState,
	normalizeWheelDeltaY,
	resetWheelGestureState,
	wheelEventTarget,
	wheelEventTimestamp,
	wheelNeedsComposedPath,
} from '../tools/smooth-scroll/wheel-input';

interface ScrollCfg {
	enabled: boolean;
	stepSize: number;
	animationTime: number;
	accelerationMax: number;
	accelerationDelta: number;
	pulseScale: number;
	respectReducedMotion: boolean;
	easing: EasingType;
}

let cfg: ScrollCfg = {
	enabled: true,
	stepSize: 300,
	animationTime: 400,
	accelerationMax: 3,
	accelerationDelta: 50,
	pulseScale: 4,
	respectReducedMotion: false,
	easing: 'spring',
};

let lastTime: number | null = null;
let accel = 1;
let accelTarget: ScrollTarget | null = null;
let accelDirection = 0;
const wheelGesture = createWheelGestureState();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);

function resetScrollRuntime(): void {
	clearQueue();
	lastTime = null;
	accel = 1;
	accelTarget = null;
	accelDirection = 0;
	resetWheelGestureState(wheelGesture);
}

function onVisibilityChange(): void {
	if (document.hidden) resetScrollRuntime();
}

function onWheel(e: WheelEvent): void {
	if (!e.isTrusted) return;
	if (e.defaultPrevented || !e.cancelable || !e.deltaY) {
		resetScrollRuntime();
		return;
	}
	if (cfg.respectReducedMotion && reducedMotion.matches) {
		resetScrollRuntime();
		return;
	}
	let eventTarget = wheelEventTarget(e);
	let composedPath: readonly EventTarget[] | undefined;
	if (!eventTarget || wheelNeedsComposedPath(eventTarget)) {
		composedPath = e.composedPath();
	}
	if (!eventTarget && composedPath) {
		for (const target of composedPath) {
			if (target instanceof Element) {
				eventTarget = target;
				break;
			}
		}
	}
	if (!eventTarget) {
		resetScrollRuntime();
		return;
	}
	const now = wheelEventTimestamp(e);
	let deltaY = normalizeWheelDeltaY(e);
	const gesture = classifyWheelGesture(e, now, wheelGesture);
	if (gesture === 'horizontal') {
		resetScrollRuntime();
		return;
	}
	const inputMode = gesture;
	const route = resolveScrollRoute(eventTarget, deltaY, composedPath);
	if (route.kind === 'native') {
		resetScrollRuntime();
		return;
	}
	if (route.kind === 'blocked') {
		e.preventDefault();
		e.stopPropagation();
		resetScrollRuntime();
		return;
	}
	const target = route.target;
	const direction = Math.sign(deltaY);

	let nextAccel = 1;
	if (inputMode === 'fine') {
		lastTime = null;
		accel = 1;
		accelTarget = null;
		accelDirection = 0;
	} else {
		const continuingStream =
			accelTarget === target &&
			accelDirection === direction &&
			lastTime !== null &&
			now - lastTime < cfg.accelerationDelta;
		nextAccel = continuingStream
			? Math.min(accel + 0.5, cfg.accelerationMax)
			: 1;
		if (Math.abs(deltaY) > 1.2) {
			deltaY = direction * cfg.stepSize;
		}
	}

	if (
		!scrollTo(
			target,
			0,
			deltaY,
			route.admission,
			inputMode,
			performance.now(),
			nextAccel,
		)
	) {
		resetScrollRuntime();
		return;
	}

	if (inputMode === 'coarse') {
		accel = nextAccel;
		lastTime = now;
		accelTarget = target;
		accelDirection = direction;
	}
	e.preventDefault();
}

function onKeydown(e: KeyboardEvent): void {
	if (!e.isTrusted) return;
	if (!SCROLL_KEYS.has(e.key)) return;
	if (e.ctrlKey || e.altKey || e.metaKey || shouldIgnoreInput(document.activeElement)) {
		resetScrollRuntime();
		return;
	}
	if (cfg.respectReducedMotion && reducedMotion.matches) {
		resetScrollRuntime();
		return;
	}

	const pageH = window.innerHeight * 0.9;
	let deltaY = 0;

	switch (e.key) {
		case 'ArrowDown': deltaY = cfg.stepSize * 0.5; break;
		case 'ArrowUp': deltaY = -cfg.stepSize * 0.5; break;
		case 'PageDown': deltaY = pageH; break;
		case 'PageUp': deltaY = -pageH; break;
		default: return;
	}

	const active = document.activeElement;
	const isGeneric =
		!active ||
		active === document.body ||
		active === document.documentElement;
	resetScrollRuntime();
	const route = isGeneric
		? resolveMainScrollRoute(deltaY)
		: resolveScrollRoute(active, deltaY, e.composedPath());
	if (route.kind === 'blocked') {
		e.preventDefault();
	} else if (
		route.kind === 'animate' &&
		scrollTo(route.target, 0, deltaY, route.admission)
	) {
		e.preventDefault();
	} else {
		resetScrollRuntime();
	}
}

// rule: guard against double-init and return a cleanup function so callers (e.g.
// tests, hot reload) can detach the listeners. Without the guard, repeated
// initScroll() calls would stack N wheel/keydown/storage listeners that each
// handled the same event, causing N scroll actions per wheel tick.
let scrollInitStarted = false;
export function initScroll(): () => void {
	if (scrollInitStarted) return () => {};
	scrollInitStarted = true;

	configure(cfg.animationTime, cfg.easing, cfg.pulseScale);
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('pagehide', resetScrollRuntime);
	document.addEventListener('visibilitychange', onVisibilityChange);

	chrome.storage.sync.get([STORAGE_KEY], (r) => {
		if (r[STORAGE_KEY]) {
			cfg = { ...cfg, ...normalizeScrollSettings(r[STORAGE_KEY]) };
			configure(cfg.animationTime, cfg.easing, cfg.pulseScale);
		}
	});

	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area === 'sync' && changes[STORAGE_KEY]) {
			cfg = { ...cfg, ...normalizeScrollSettings(changes[STORAGE_KEY].newValue) };
			configure(cfg.animationTime, cfg.easing, cfg.pulseScale);
		}
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('keydown', onKeydown);
		window.removeEventListener('pagehide', resetScrollRuntime);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		chrome.storage.onChanged.removeListener(listener);
		resetScrollRuntime();
		scrollInitStarted = false;
	};
}
