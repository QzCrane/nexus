// goal: Hover Zoom content module entry (thin wrapper)
// eff: Imports and initializes core logic from tools/hover-zoom/

import { DEFAULT_SETTINGS, STORAGE_KEY, HoverZoomSettings } from '../tools/hover-zoom/types';
import { TriggerDetector } from '../tools/hover-zoom/content/trigger-detector';
import { HoverZoomViewer } from '../tools/hover-zoom/content/viewer';
import { HotkeyManager } from '../tools/hover-zoom/content/hotkeys';

const LOG_TAG = '[HALO:HoverZoom]';
let viewer: HoverZoomViewer | null = null;
let detector: TriggerDetector | null = null;
let hotkeys: HotkeyManager | null = null;
let settings: HoverZoomSettings = DEFAULT_SETTINGS;
let currentTarget: HTMLElement | null = null;
let hoverTimer: number | null = null;
let lastX = 0, lastY = 0;

const onOver = (e: MouseEvent) => {
	if (!settings.enabled || !detector) return;
	const t = e.target as HTMLElement;
	if (t === currentTarget || !detector.checkModifiers(e)) return;
	const src = detector.detect(t);
	if (src) { currentTarget = t; lastX = e.clientX; lastY = e.clientY; startTimer(src); }
};

const onOut = (e: MouseEvent) => {
	if (e.target === currentTarget) {
		if ((e.relatedTarget as HTMLElement)?.closest('#halo-hover-zoom-container')) return;
		cancel();
	}
};

const onMove = (e: MouseEvent) => { lastX = e.clientX; lastY = e.clientY; };

const startTimer = (src: ReturnType<TriggerDetector['detect']>) => {
	clearTimer();
	hoverTimer = window.setTimeout(() => viewer?.show(src!, lastX, lastY), settings.triggerDelay);
};

const clearTimer = () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } };
const cancel = () => { clearTimer(); viewer?.hide(); currentTarget = null; };

export async function init(): Promise<void> {
	if (window.location.protocol === 'chrome-extension:') return;

	console.log(LOG_TAG, 'Initializing...');

	try {
		const res = await chrome.storage.local.get(STORAGE_KEY);
		console.log(LOG_TAG, 'Storage result:', res);
		if (res[STORAGE_KEY]) settings = { ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] };
	} catch (e) {
		console.warn(LOG_TAG, 'Storage error, using defaults:', e);
	}

	console.log(LOG_TAG, 'Settings:', { enabled: settings.enabled, triggerKey: settings.triggerKey, delay: settings.triggerDelay });

	// Always initialize - we'll check enabled on each event
	detector = new TriggerDetector(settings);
	viewer = new HoverZoomViewer(settings);
	hotkeys = new HotkeyManager(settings, viewer);

	document.addEventListener('mouseover', onOver, true);
	document.addEventListener('mouseout', onOut, true);
	document.addEventListener('mousemove', onMove, { passive: true });

	chrome.storage.onChanged.addListener((c, a) => {
		if (a === 'local' && c[STORAGE_KEY]) {
			settings = { ...DEFAULT_SETTINGS, ...c[STORAGE_KEY].newValue };
			detector?.updateSettings(settings);
			viewer?.updateSettings(settings);
			hotkeys?.updateSettings(settings);
			console.log(LOG_TAG, 'Settings updated:', settings.enabled);
		}
	});

	console.log(LOG_TAG, 'Ready, enabled:', settings.enabled);
}
