// goal: Hover Zoom content module entry
// eff: Robust trigger with keydown support, proper hide on any move away

import { DEFAULT_SETTINGS, STORAGE_KEY, HoverZoomSettings } from '../tools/hover-zoom/types';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer/index';
import { HotkeyManager } from '../tools/hover-zoom/content/hotkeys';
import { isValidTrigger } from '../tools/hover-zoom/content/image-resolver';
import {
	initRulesForHost,
	resolveEnhanced,
	detectQuick,
	checkModifiers
} from '../tools/hover-zoom/content/rule-resolver';
import {
	detectResourcePreference,
	shouldTriggerActivate,
	type ResourcePreference
} from '../tools/hover-zoom/content/resource-key-helper';

const LOG_TAG = '[HALO:HoverZoom]';
let initialized = false;
let viewer: HoverZoomViewer | null = null;
let hotkeys: HotkeyManager | null = null;
let settings: HoverZoomSettings = DEFAULT_SETTINGS;
let currentTarget: HTMLElement | null = null;
let hoverTimer: number | null = null;
let lastX = 0, lastY = 0;
let mouseHasMoved = false; // Track if mouse has moved at least once
let modifiersActive = false;
let toggleLocked = false; // For toggle mode: viewer stays until key pressed again
let currentResourcePref: ResourcePreference = 'auto'; // Current resource preference based on keys

// Performance: Preload cache and pending resolution
let preloadCache = new WeakMap<HTMLElement, { result: any; url: string }>();
let pendingPreload: HTMLElement | null = null;
let preloadImage: HTMLImageElement | null = null;

const ensureViewer = () => {
	if (!viewer) {
		viewer = new HoverZoomViewer(settings);
		hotkeys = new HotkeyManager(settings, viewer);
	}
	return viewer;
};

/**
 * Get element at current mouse position
 */
const getElementAtMouse = (): HTMLElement | null => {
	const el = document.elementFromPoint(lastX, lastY);
	return el as HTMLElement | null;
};

/**
 * Check if mouse is over viewer container
 */
const isOverViewer = (): boolean => {
	const viewerEl = document.getElementById('halo-hover-zoom-container');
	if (!viewerEl) return false;
	const rect = viewerEl.querySelector('.halo-hz-viewer')?.getBoundingClientRect();
	if (!rect) return false;
	return lastX >= rect.left && lastX <= rect.right && lastY >= rect.top && lastY <= rect.bottom;
};

/**
 * Preload image URL to warm up browser cache
 */
const preloadUrl = (url: string) => {
	if (!url || url.startsWith('data:')) return;
	if (!preloadImage) preloadImage = new Image();
	preloadImage.src = url;
};

/**
 * Try to trigger on element at current position
 * Uses preloaded result if available for instant display
 */
const tryTrigger = async (target: HTMLElement) => {
	if (!isValidTrigger(target)) return;

	const cached = preloadCache.get(target);
	if (cached) {
		// Instant path: use preloaded result
		currentTarget = target;
		const v = ensureViewer();
		v.show(cached.result, lastX, lastY);
		return;
	}

	const quickSrc = detectQuick(target, settings);
	if (quickSrc) {
		currentTarget = target;
		// Start preloading immediately (before delay)
		preloadUrl(quickSrc.url);
		startTimer(target);
	}
};

const onOver = (e: MouseEvent) => {
	if (!settings.enabled) return;
	lastX = e.clientX;
	lastY = e.clientY;

	const t = e.target as HTMLElement;

	// Ignore events on the viewer itself (prevent flicker when mouse moves to viewer)
	if (t.closest('#halo-hover-zoom-container')) return;

	// Detect resource preference based on modifier keys
	const resourcePref = detectResourcePreference(settings.resourceKeys, e);
	if (resourcePref === null) {
		// No valid key combination, don't trigger
		modifiersActive = false;
		return;
	}
	modifiersActive = true;
	currentResourcePref = resourcePref;

	if (t === currentTarget) return;

	// Check if moving within same container (avoid flicker from DOM changes)
	if (currentTarget) {
		const currentContainer = currentTarget.closest('a, [data-target-url], .bili-video-card');
		const newContainer = t.closest('a, [data-target-url], .bili-video-card');
		if (currentContainer && currentContainer === newContainer) {
			// Still in same container, don't restart
			return;
		}
		cancel();
	}

	tryTrigger(t);

	// Preload next likely target (sibling images) for even faster response
	if (pendingPreload !== t && isValidTrigger(t)) {
		pendingPreload = t;
		// Schedule preload resolution
		queueMicrotask(async () => {
			if (pendingPreload !== t) return;
			const result = await resolveEnhanced(t, currentResourcePref);
			if (result && pendingPreload === t) {
				preloadCache.set(t, { result, url: result.url });
				preloadUrl(result.url);
			}
		});
	}
};

const onOut = (e: MouseEvent) => {
	const relatedTarget = e.relatedTarget as HTMLElement;

	// If moving to viewer, keep visible
	if (relatedTarget?.closest('#halo-hover-zoom-container')) return;

	// If moving within the same trigger container, ignore
	if (currentTarget && relatedTarget) {
		// Check if relatedTarget is inside currentTarget (DOM changed but still in same area)
		if (currentTarget.contains(relatedTarget) || relatedTarget.contains(currentTarget)) {
			return;
		}
		// Check if both are in same link/image container
		const currentContainer = currentTarget.closest('a, [data-target-url], .bili-video-card');
		const relatedContainer = relatedTarget.closest('a, [data-target-url], .bili-video-card');
		if (currentContainer && currentContainer === relatedContainer) {
			return;
		}
	}

	// If leaving current target, hide
	if (e.target === currentTarget || currentTarget?.contains(e.target as Node)) {
		cancel();
	}
};

const onMove = (e: MouseEvent) => {
	lastX = e.clientX;
	lastY = e.clientY;
	mouseHasMoved = true;

	// If viewer visible, check if we should hide
	if (viewer?.getIsVisible()) {
		// Don't hide if over viewer itself
		if (isOverViewer()) return;

		// Hide if no longer over current target
		if (currentTarget) {
			const rect = currentTarget.getBoundingClientRect();
			const overTarget = lastX >= rect.left && lastX <= rect.right &&
				lastY >= rect.top && lastY <= rect.bottom;
			if (!overTarget) {
				cancel();
			}
		}
	}
};

/**
 * Handle keydown - enable detection at current position
 * Supports both 'hold' and 'toggle' modes
 */
const onKeyDown = (e: KeyboardEvent) => {
	if (!settings.enabled) return;

	// Check if this is our trigger key
	const key = settings.triggerKey;
	if (key === 'none') return;
	if (key === 'shift' && !e.shiftKey) return;
	if (key === 'ctrl' && !e.ctrlKey) return;
	if (key === 'alt' && !e.altKey) return;

	// Prevent repeat events (key held down)
	if (e.repeat) return;

	modifiersActive = true;

	// Toggle mode: if viewer visible and locked, close it
	if (settings.triggerAction === 'toggle' && toggleLocked && viewer?.getIsVisible()) {
		toggleLocked = false;
		cancel();
		return;
	}

	// Try to detect at mouse position
	if (!mouseHasMoved) {
		// Mouse hasn't moved yet - cannot determine position
		return;
	}

	if (!currentTarget && !viewer?.getIsVisible()) {
		const el = getElementAtMouse();
		if (el) {
			tryTrigger(el);
			// For toggle mode, lock the viewer open
			if (settings.triggerAction === 'toggle') {
				toggleLocked = true;
			}
		}
	}
};

/**
 * Handle keyup - hide viewer when modifier released (hold mode only)
 */
const onKeyUp = (e: KeyboardEvent) => {
	const key = settings.triggerKey;
	if (key === 'none') return;

	// In toggle mode, don't hide on key release
	if (settings.triggerAction === 'toggle') {
		return;
	}

	const shouldHide =
		(key === 'shift' && e.key === 'Shift') ||
		(key === 'ctrl' && (e.key === 'Control' || e.key === 'Meta')) ||
		(key === 'alt' && e.key === 'Alt');

	if (shouldHide) {
		modifiersActive = false;
		cancel();
	}
};

/**
 * Click anywhere to hide
 */
const onClick = () => {
	if (viewer?.getIsVisible()) {
		cancel();
	}
};

const startTimer = (target: HTMLElement) => {
	clearTimer();

	// Reduced delay for cached results
	const delay = preloadCache.has(target) ? 0 : settings.triggerDelay;

	hoverTimer = window.setTimeout(async () => {
		// Verify still valid
		if (currentTarget !== target) return;

		try {
			// Check cache first
			const cached = preloadCache.get(target);
			if (cached) {
				const v = ensureViewer();
				v.show(cached.result, lastX, lastY);
				return;
			}

			const result = await resolveEnhanced(target, currentResourcePref);
			if (!result || currentTarget !== target) return;

			// Cache for future use
			preloadCache.set(target, { result, url: result.url });

			const v = ensureViewer();
			v.show(result, lastX, lastY);
		} catch (e) {
			console.warn(LOG_TAG, 'Resolution error:', e);
		}
	}, delay);
};

const clearTimer = () => {
	if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
};

const cancel = () => {
	clearTimer();
	viewer?.hide();
	currentTarget = null;
	toggleLocked = false;
};

export async function init(): Promise<void> {
	if (window.location.protocol === 'chrome-extension:') return;
	if (window !== window.top) return;
	if (initialized) return;
	initialized = true;

	console.log(LOG_TAG, 'Initializing...');

	try {
		const res = await chrome.storage.local.get(STORAGE_KEY);
		if (res[STORAGE_KEY]) settings = { ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] };
	} catch (e) {
		console.warn(LOG_TAG, 'Storage error:', e);
	}

	await initRulesForHost();

	// Mouse events
	document.addEventListener('mouseover', onOver, true);
	document.addEventListener('mouseout', onOut, true);
	document.addEventListener('mousemove', onMove, { passive: true });
	document.addEventListener('click', onClick, true);

	// Keyboard events for trigger key
	document.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('keyup', onKeyUp, true);

	// Settings sync
	chrome.storage.onChanged.addListener((c, a) => {
		if (a === 'local' && c[STORAGE_KEY]) {
			settings = { ...DEFAULT_SETTINGS, ...c[STORAGE_KEY].newValue };
			viewer?.updateSettings(settings);
			hotkeys?.updateSettings(settings);
		}
	});

	console.log(LOG_TAG, 'Ready');
}
