// goal: Smooth Scroll content script
// inv: Logic split into handlers and state

import { clearQueue, configure } from '../tools/smooth-scroll/engine';
import { STORAGE_KEY } from '../tools/smooth-scroll/types';
import {
	resetRuntimeState,
	settings,
	updateStateSettings,
} from './smooth-scroll-state';
import {
	onKeydownCapture,
	onKeyup,
	onMouseDown,
	onWheel,
	resetInputHandlers,
} from './smooth-scroll-handlers';

const updateSettings = (value: unknown): void => {
	const wasEnabled = settings.enabled;
	const next = updateStateSettings(value);
	configure(next.animationTime, next.easing, next.pulseScale);

	if (next.enabled && !wasEnabled) attachListeners();
	else if (!next.enabled && wasEnabled) detachListeners();
};

let listenersAttached = false;

const resetDocumentRuntime = (): void => {
	clearQueue();
	resetInputHandlers();
	resetRuntimeState();
};

const onVisibilityChange = (): void => {
	if (document.hidden) resetDocumentRuntime();
};

const attachListeners = (): void => {
	if (listenersAttached) return;
	listenersAttached = true;
	window.addEventListener('wheel', onWheel, { passive: false });
	// HALO is injected at document_start. Register capture synchronously before
	// the first await so the pre-site snapshot is not weakened by DOMContentLoaded
	// or timer ordering. The per-event bubble finalizer still gives ordinary page
	// handlers first refusal before HALO decides whether to animate.
	window.addEventListener('keydown', onKeydownCapture, true);
	window.addEventListener('keyup', onKeyup, true);
	window.addEventListener('mousedown', onMouseDown);
	window.addEventListener('blur', resetDocumentRuntime);
	window.addEventListener('pagehide', resetDocumentRuntime);
	document.addEventListener('visibilitychange', onVisibilityChange);
};

const detachListeners = (): void => {
	if (!listenersAttached) return;
	listenersAttached = false;
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('keydown', onKeydownCapture, true);
	window.removeEventListener('keyup', onKeyup, true);
	window.removeEventListener('mousedown', onMouseDown);
	window.removeEventListener('blur', resetDocumentRuntime);
	window.removeEventListener('pagehide', resetDocumentRuntime);
	document.removeEventListener('visibilitychange', onVisibilityChange);
	resetDocumentRuntime();
};

// rule: guard against double-init and return a cleanup function so callers (e.g.
// tests, hot reload) can detach the storage listener. Without the guard, repeated
// init() calls would stack N storage.onChanged listeners that each called
// updateSettings, amplifying one storage write into N updates.
let initStarted = false;
export async function init(): Promise<() => void> {
	if (initStarted) return () => {};
	initStarted = true;

	if (window !== window.top || location.protocol === 'chrome-extension:') {
		initStarted = false;
		return () => {};
	}

	configure(settings.animationTime, settings.easing, settings.pulseScale);
	if (settings.enabled) attachListeners();

	const listener = (
		changes: { [key: string]: chrome.storage.StorageChange },
		areaName: string,
	): void => {
		if (areaName === 'sync' && changes[STORAGE_KEY]) {
			updateSettings(changes[STORAGE_KEY].newValue);
		}
	};
	chrome.storage.onChanged.addListener(listener);

	try {
		const result = await chrome.storage.sync.get([STORAGE_KEY]);
		updateSettings(result[STORAGE_KEY]);
	} catch (error: unknown) {
		console.warn('[HALO:Scroll] Failed to restore settings; using defaults', error);
	}

	return () => {
		detachListeners();
		chrome.storage.onChanged.removeListener(listener);
		initStarted = false;
	};
}
