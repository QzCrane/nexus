// goal: SidePanel smooth scroll logic - separated for line limit compliance
// inv: Always active in sidepanel, ignores the 'enabled' setting (only for web pages)

import { scrollTo, configure } from '../tools/smooth-scroll/engine';
import type { EasingType } from '../tools/smooth-scroll/types';

interface ScrollCfg {
	enabled: boolean;
	stepSize: number;
	animationTime: number;
	accelerationMax: number;
	accelerationDelta: number;
	easing: EasingType;
}

let cfg: ScrollCfg = {
	enabled: true,
	stepSize: 300,
	animationTime: 400,
	accelerationMax: 3,
	accelerationDelta: 50,
	easing: 'spring',
};

let lastTime = 0;
let accel = 1;

function findScrollable(el: HTMLElement | null): HTMLElement {
	while (el && el !== document.body) {
		const s = getComputedStyle(el);
		if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
			return el;
		}
		el = el.parentElement;
	}
	return document.documentElement;
}

const hotTarget: { el: HTMLElement, ts: number, ref: EventTarget | null } = {
	el: document.documentElement, ts: 0, ref: null
};

function onWheel(e: WheelEvent): void {
	const now = Date.now();
	let target: HTMLElement;

	// eff: Hot cache check (150ms TTL) to avoid expensive DOM traversal
	if (now - hotTarget.ts < 150 && hotTarget.ref === e.target) {
		target = hotTarget.el;
		hotTarget.ts = now;
	} else {
		target = findScrollable(e.target as HTMLElement);
		hotTarget.el = target;
		hotTarget.ts = now;
		hotTarget.ref = e.target;
	}

	const max = target.scrollHeight - target.clientHeight;
	if (max <= 0) return;

	const isDown = e.deltaY > 0, isUp = e.deltaY < 0;
	const atTop = target.scrollTop <= 0, atBot = target.scrollTop >= max - 1;

	// Boundary bubbling check
	if (target !== document.documentElement && ((atTop && isUp) || (atBot && isDown))) {
		// If hit boundary, force re-scan parent next time or bubble now?
		// Bubbling logic requires traversing up.
		// For simplicity/perf in sidepanel, let's just let browser bubble or stop.
		// But original logic bubbled. Let's start bubble search from current target's parent.
		let bubble = target.parentElement;
		while (bubble && bubble !== document.body) {
			target = findScrollable(bubble);
			const bMax = target.scrollHeight - target.clientHeight;
			if (bMax > 0 && !((target.scrollTop <= 0 && isUp) || (target.scrollTop >= bMax - 1 && isDown))) {
				break;
			}
			if (target === document.documentElement) break;
			bubble = target.parentElement;
		}
		// Update cache with the bubbled target to stick to it
		hotTarget.el = target;
	}

	if (target.scrollHeight - target.clientHeight <= 0) return;

	e.preventDefault();

	accel = now - lastTime < cfg.accelerationDelta ? Math.min(accel + 0.5, cfg.accelerationMax) : 1;
	lastTime = now;

	scrollTo(target, 0, (e.deltaY > 0 ? 1 : -1) * cfg.stepSize * accel);
}

function shouldIgnore(el: Element | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function onKeydown(e: KeyboardEvent): void {
	if (e.ctrlKey || e.altKey || e.metaKey || shouldIgnore(document.activeElement)) return;

	// rule: For keyboard, find scrollable from focused element or fallback to main scroll area
	let target = findScrollable(document.activeElement as HTMLElement);
	if (target === document.documentElement) {
		// Fallback: find main scrollable container (React renders .halo-scrollbar for scroll areas)
		const scrollAreas = document.querySelectorAll('.halo-scrollbar, [style*="overflow"]');
		for (const area of scrollAreas) {
			const el = area as HTMLElement;
			if (el.scrollHeight > el.clientHeight + 10) {
				target = el;
				break;
			}
		}
	}
	if (target.scrollHeight - target.clientHeight <= 0) return;

	const pageH = window.innerHeight * 0.9;
	let deltaY = 0;

	switch (e.key) {
		case 'ArrowDown': deltaY = cfg.stepSize * 0.5; break;
		case 'ArrowUp': deltaY = -cfg.stepSize * 0.5; break;
		case 'PageDown': deltaY = pageH; break;
		case 'PageUp': deltaY = -pageH; break;
		default: return;
	}

	e.preventDefault();
	scrollTo(target, 0, deltaY);
}

// rule: guard against double-init and return a cleanup function so callers (e.g.
// tests, hot reload) can detach the listeners. Without the guard, repeated
// initScroll() calls would stack N wheel/keydown/storage listeners that each
// handled the same event, causing N scroll actions per wheel tick.
let scrollInitStarted = false;
export function initScroll(): () => void {
	if (scrollInitStarted) return () => {};
	scrollInitStarted = true;

	configure(cfg.animationTime, cfg.easing);
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);

	chrome.storage.sync.get(['HALO_SMOOTH_SCROLL_SETTINGS'], (r) => {
		if (r.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...r.HALO_SMOOTH_SCROLL_SETTINGS };
			configure(cfg.animationTime, cfg.easing);
		}
	});

	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...changes.HALO_SMOOTH_SCROLL_SETTINGS.newValue };
			configure(cfg.animationTime, cfg.easing);
		}
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('keydown', onKeydown);
		chrome.storage.onChanged.removeListener(listener);
		scrollInitStarted = false;
	};
}
