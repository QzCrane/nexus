// goal: SidePanel early init (theme + smooth scroll) - CSP compliant
// inv: Runs before React, uses queue-based scroll engine

import { scrollTo, configure } from '../tools/smooth-scroll/engine';
import type { EasingType } from '../tools/smooth-scroll/engine';

// ===== Theme =====
const DARK = {
	'--halo-bg': '#1a1a1a',
	'--halo-bg-secondary': '#242424',
	'--halo-bg-tertiary': '#2a2a2a',
	'--halo-text': '#f0f0f0',
	'--halo-text-secondary': '#b0b0b0',
	'--halo-text-muted': '#666666',
	'--halo-border': '#444444',
};

const LIGHT = {
	'--halo-bg': '#ffffff',
	'--halo-bg-secondary': '#f5f5f5',
	'--halo-bg-tertiary': '#eeeeee',
	'--halo-text': '#1a1a1a',
	'--halo-text-secondary': '#555555',
	'--halo-text-muted': '#888888',
	'--halo-border': '#dddddd',
};

function initTheme(): void {
	try {
		chrome.storage.sync.get(['HALO_SETTINGS'], (result) => {
			const s = result.HALO_SETTINGS || {};
			const mode = s.theme || 'dark';
			const isDark =
				mode === 'dark' ||
				(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
			const colors = isDark ? DARK : LIGHT;
			for (const [k, v] of Object.entries(colors)) {
				document.documentElement.style.setProperty(k, v);
			}
		});
	} catch {
		// Extension context only
	}
}

// ===== Scroll Settings =====
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

// ===== Scroll Target =====
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

// ===== Wheel Handler =====
// inv: Sidepanel smooth scroll is ALWAYS active, ignores the 'enabled' setting
// The 'enabled' setting only controls web page scroll (via content.ts)
function onWheel(e: WheelEvent): void {
	let target = findScrollable(e.target as HTMLElement);
	const isScrollingDown = e.deltaY > 0;
	const isScrollingUp = e.deltaY < 0;

	// Check if at boundary and need to bubble up to parent scrollable
	while (target && target !== document.documentElement) {
		const max = target.scrollHeight - target.clientHeight;
		if (max <= 0) {
			// Not scrollable, try parent
			target = findScrollable(target.parentElement);
			continue;
		}

		const atTop = target.scrollTop <= 0;
		const atBottom = target.scrollTop >= max - 1; // tolerance for rounding

		// At boundary scrolling in boundary direction: try parent
		if ((atTop && isScrollingUp) || (atBottom && isScrollingDown)) {
			target = findScrollable(target.parentElement);
			continue;
		}

		// Found a scrollable target not at boundary
		break;
	}

	// Final check: if we bubbled up to documentElement or no scrollable found
	const max = target.scrollHeight - target.clientHeight;
	if (max <= 0) return;

	// Check boundary for final target
	const atTop = target.scrollTop <= 0;
	const atBottom = target.scrollTop >= max - 1;
	if ((atTop && isScrollingUp) || (atBottom && isScrollingDown)) {
		return; // Let browser handle (no more parents to scroll)
	}

	e.preventDefault();

	// Acceleration
	const now = Date.now();
	if (now - lastTime < cfg.accelerationDelta) {
		accel = Math.min(accel + 0.5, cfg.accelerationMax);
	} else {
		accel = 1;
	}
	lastTime = now;

	// Delta
	const deltaY = (e.deltaY > 0 ? 1 : -1) * cfg.stepSize * accel;

	scrollTo(target, 0, deltaY);
}

// ===== Init =====
function initScroll(): void {
	configure(cfg.animationTime, cfg.easing);

	window.addEventListener('wheel', onWheel, { passive: false });

	// Load settings
	chrome.storage.sync.get(['HALO_SMOOTH_SCROLL_SETTINGS'], (r) => {
		if (r.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...r.HALO_SMOOTH_SCROLL_SETTINGS };
			configure(cfg.animationTime, cfg.easing);
		}
	});

	// Listen for changes
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) {
			cfg = { ...cfg, ...changes.HALO_SMOOTH_SCROLL_SETTINGS.newValue };
			configure(cfg.animationTime, cfg.easing);
		}
	});
}

// Execute
initTheme();
initScroll();

// Sync SaaT tools
import { syncSaaTTools } from '../kernel/services/saat-service';
import { TOOL_REGISTRY } from '../kernel/registry/tool-registry';

syncSaaTTools(TOOL_REGISTRY).catch(e => console.error('SaaT Sync Failed:', e));
