// goal: Hover Zoom content module entry
// eff: Robust trigger with keydown support, proper hide on any move away

import { DEFAULT_SETTINGS, STORAGE_KEY, HoverZoomSettings } from '../tools/hover-zoom/types';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer';
import { HotkeyManager } from '../tools/hover-zoom/content/hotkeys';
import { isValidTrigger } from '../tools/hover-zoom/content/image-resolver';
import {
	initRulesForHost,
	resolveEnhanced,
	detectQuick,
	checkModifiers
} from '../tools/hover-zoom/content/rule-resolver';

const LOG_TAG = '[HALO:HoverZoom]';
let initialized = false;
let viewer: HoverZoomViewer | null = null;
let hotkeys: HotkeyManager | null = null;
let settings: HoverZoomSettings = DEFAULT_SETTINGS;
let currentTarget: HTMLElement | null = null;
let hoverTimer: number | null = null;
let lastX = 0, lastY = 0;
let modifiersActive = false;

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
 * Try to trigger on element at current position
 */
const tryTrigger = (target: HTMLElement) => {
	if (!isValidTrigger(target)) return;

	const quickSrc = detectQuick(target, settings);
	if (quickSrc) {
		currentTarget = target;
		startTimer(target);
	}
};

const onOver = (e: MouseEvent) => {
	if (!settings.enabled) return;
	lastX = e.clientX;
	lastY = e.clientY;

	// Check modifiers for trigger mode
	if (settings.triggerKey !== 'none' && !checkModifiers(e, settings)) {
		modifiersActive = false;
		return;
	}
	modifiersActive = true;

	const t = e.target as HTMLElement;
	if (t === currentTarget) return;

	// Cancel current if switching to new target
	if (currentTarget) cancel();

	tryTrigger(t);
};

const onOut = (e: MouseEvent) => {
	const relatedTarget = e.relatedTarget as HTMLElement;

	// If moving to viewer, keep visible
	if (relatedTarget?.closest('#halo-hover-zoom-container')) return;

	// If leaving current target, hide
	if (e.target === currentTarget) {
		cancel();
	}
};

const onMove = (e: MouseEvent) => {
	lastX = e.clientX;
	lastY = e.clientY;

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
 */
const onKeyDown = (e: KeyboardEvent) => {
	if (!settings.enabled) return;

	// Check if this is our trigger key
	const key = settings.triggerKey;
	if (key === 'none') return;
	if (key === 'shift' && !e.shiftKey) return;
	if (key === 'ctrl' && !e.ctrlKey) return;
	if (key === 'alt' && !e.altKey) return;

	modifiersActive = true;

	// If no current target, try to detect at mouse position
	if (!currentTarget && !viewer?.getIsVisible()) {
		const el = getElementAtMouse();
		if (el) tryTrigger(el);
	}
};

/**
 * Handle keyup - hide viewer when modifier released
 */
const onKeyUp = (e: KeyboardEvent) => {
	const key = settings.triggerKey;
	if (key === 'none') return;

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

	hoverTimer = window.setTimeout(async () => {
		// Verify still valid
		if (currentTarget !== target) return;

		try {
			const result = await resolveEnhanced(target);
			if (!result || currentTarget !== target) return;

			const v = ensureViewer();
			v.show(result, lastX, lastY);
		} catch (e) {
			console.warn(LOG_TAG, 'Resolution error:', e);
		}
	}, settings.triggerDelay);
};

const clearTimer = () => {
	if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
};

const cancel = () => {
	clearTimer();
	viewer?.hide();
	currentTarget = null;
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
