// goal: Hover Zoom content module entry
// eff: Responsive trigger detection with immediate hide on mouse leave

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

const ensureViewer = () => {
	if (!viewer) {
		viewer = new HoverZoomViewer(settings);
		hotkeys = new HotkeyManager(settings, viewer);
	}
	return viewer;
};

/**
 * Check if mouse is still over target element
 */
const isMouseOverTarget = (target: HTMLElement, x: number, y: number): boolean => {
	const rect = target.getBoundingClientRect();
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

const onOver = (e: MouseEvent) => {
	if (!settings.enabled) return;
	const t = e.target as HTMLElement;

	// Skip if already on this target
	if (t === currentTarget) return;

	// Check modifiers
	if (!checkModifiers(e, settings)) return;

	// Strict validation: only image/video/background elements
	if (!isValidTrigger(t)) return;

	// Quick detect
	const quickSrc = detectQuick(t, settings);
	if (quickSrc) {
		currentTarget = t;
		lastX = e.clientX;
		lastY = e.clientY;
		startTimer(t);
	}
};

const onOut = (e: MouseEvent) => {
	const relatedTarget = e.relatedTarget as HTMLElement;

	// Don't hide if moving to viewer container
	if (relatedTarget?.closest('#halo-hover-zoom-container')) return;

	// Cancel if leaving current target
	if (e.target === currentTarget) {
		cancel();
	}
};

const onMove = (e: MouseEvent) => {
	lastX = e.clientX;
	lastY = e.clientY;

	// If viewer is visible but mouse left the trigger area, hide immediately
	if (viewer?.getIsVisible() && currentTarget) {
		if (!isMouseOverTarget(currentTarget, lastX, lastY)) {
			// Also check if mouse is over viewer
			const viewerEl = document.getElementById('halo-hover-zoom-container');
			if (!viewerEl || !isMouseOverElement(viewerEl, lastX, lastY)) {
				cancel();
			}
		}
	}
};

const isMouseOverElement = (el: HTMLElement, x: number, y: number): boolean => {
	const rect = el.getBoundingClientRect();
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

const startTimer = (target: HTMLElement) => {
	clearTimer();

	hoverTimer = window.setTimeout(async () => {
		// Verify mouse is still over target
		if (!isMouseOverTarget(target, lastX, lastY)) {
			cancel();
			return;
		}

		try {
			const result = await resolveEnhanced(target);
			if (!result) return;

			// Double check before showing
			if (currentTarget !== target) return;

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
		console.warn(LOG_TAG, 'Storage error, using defaults:', e);
	}

	await initRulesForHost();

	console.log(LOG_TAG, 'Settings:', { enabled: settings.enabled, delay: settings.triggerDelay });

	document.addEventListener('mouseover', onOver, true);
	document.addEventListener('mouseout', onOut, true);
	document.addEventListener('mousemove', onMove, { passive: true });

	chrome.storage.onChanged.addListener((c, a) => {
		if (a === 'local' && c[STORAGE_KEY]) {
			settings = { ...DEFAULT_SETTINGS, ...c[STORAGE_KEY].newValue };
			viewer?.updateSettings(settings);
			hotkeys?.updateSettings(settings);
		}
	});

	console.log(LOG_TAG, 'Ready');
}
