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

function onWheel(e: WheelEvent): void {
	let target = findScrollable(e.target as HTMLElement);
	const isDown = e.deltaY > 0, isUp = e.deltaY < 0;

	while (target && target !== document.documentElement) {
		const max = target.scrollHeight - target.clientHeight;
		if (max <= 0) { target = findScrollable(target.parentElement); continue; }
		const atTop = target.scrollTop <= 0, atBot = target.scrollTop >= max - 1;
		if ((atTop && isUp) || (atBot && isDown)) { target = findScrollable(target.parentElement); continue; }
		break;
	}

	const max = target.scrollHeight - target.clientHeight;
	if (max <= 0) return;
	const atTop = target.scrollTop <= 0, atBot = target.scrollTop >= max - 1;
	if ((atTop && isUp) || (atBot && isDown)) return;

	e.preventDefault();

	const now = Date.now();
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

export function initScroll(): void {
	configure(cfg.animationTime, cfg.easing);
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);

	chrome.storage.sync.get(['HALO_SMOOTH_SCROLL_SETTINGS'], (r) => {
		if (r.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...r.HALO_SMOOTH_SCROLL_SETTINGS };
			configure(cfg.animationTime, cfg.easing);
		}
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...changes.HALO_SMOOTH_SCROLL_SETTINGS.newValue };
			configure(cfg.animationTime, cfg.easing);
		}
	});
}
