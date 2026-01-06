// goal: Hover Zoom content module entry (thin wrapper)
// eff: Imports and initializes core logic from tools/hover-zoom/

import { DEFAULT_SETTINGS, STORAGE_KEY, HoverZoomSettings } from '../tools/hover-zoom/types';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer';
import { HotkeyManager } from '../tools/hover-zoom/content/hotkeys';
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
let resolvingTarget: HTMLElement | null = null;
let lastX = 0, lastY = 0;

const ensureViewer = () => {
	if (!viewer) {
		viewer = new HoverZoomViewer(settings);
		hotkeys = new HotkeyManager(settings, viewer);
	}
	return viewer;
};

const onOver = (e: MouseEvent) => {
	if (!settings.enabled) return;
	const t = e.target as HTMLElement;
	if (t === currentTarget || t === resolvingTarget) return;

	if (!checkModifiers(e, settings)) return;

	const quickSrc = detectQuick(t, settings);
	if (quickSrc) {
		console.log(LOG_TAG, 'Quick detect:', quickSrc.url.slice(0, 60));
		currentTarget = t;
		lastX = e.clientX;
		lastY = e.clientY;
		startTimer(t);
	}
};

const onOut = (e: MouseEvent) => {
	if (e.target === currentTarget || e.target === resolvingTarget) {
		if ((e.relatedTarget as HTMLElement)?.closest('#halo-hover-zoom-container')) return;
		cancel();
	}
};

const onMove = (e: MouseEvent) => { lastX = e.clientX; lastY = e.clientY; };

const startTimer = (target: HTMLElement) => {
	clearTimer();
	resolvingTarget = target;

	hoverTimer = window.setTimeout(async () => {
		if (resolvingTarget !== target) return;

		try {
			const result = await resolveEnhanced(target);
			if (!result || resolvingTarget !== target) return;

			console.log(LOG_TAG, 'Resolved:', result.fromRule || 'generic', result.url.slice(0, 80));

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
	resolvingTarget = null;
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

	console.log(LOG_TAG, 'Settings:', { enabled: settings.enabled, triggerKey: settings.triggerKey, delay: settings.triggerDelay });

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

	console.log(LOG_TAG, 'Ready, enabled:', settings.enabled);
}
