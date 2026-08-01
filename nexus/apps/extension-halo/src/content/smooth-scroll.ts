// goal: Smooth Scroll content script
// inv: Logic split into handlers and state

import { configure, clearQueue } from '../tools/smooth-scroll/engine';
import { STORAGE_KEY } from '../tools/smooth-scroll/types';
import { settings, updateStateSettings } from './smooth-scroll-state';
import { resetRuntimeState } from './smooth-scroll-state';
import {
	onArrowKeydownCapture,
	onKeyboardFocusIn,
	onKeyboardPointerDown,
	onKeydown,
	onMouseDown,
	onWheel,
	resetInputHandlers,
} from './smooth-scroll-handlers';

const updateSettings = (value: unknown): void => {
	const was = settings.enabled;
	const next = updateStateSettings(value);
	configure(next.animationTime, next.easing, next.pulseScale);

	if (next.enabled && !was) attachListeners();
	else if (!next.enabled && was) detachListeners();
}

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
	// Arrow keys use capture only when HALO can admit a page scroll; discrete
	// page keys remain bubble-phase so site handlers get first refusal. Pointer
	// and focus capture own the media-interaction token independently of whether
	// a site's player makes its underlying <video> focusable.
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('pointerdown', onKeyboardPointerDown, {
		capture: true,
		passive: true,
	});
	window.addEventListener('focusin', onKeyboardFocusIn, true);
	window.addEventListener('keydown', onArrowKeydownCapture, true);
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMouseDown);
	window.addEventListener('pagehide', resetDocumentRuntime);
	document.addEventListener('visibilitychange', onVisibilityChange);
}

const detachListeners = (): void => {
	if (!listenersAttached) return;
	listenersAttached = false;
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('pointerdown', onKeyboardPointerDown, true);
	window.removeEventListener('focusin', onKeyboardFocusIn, true);
	window.removeEventListener('keydown', onArrowKeydownCapture, true);
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMouseDown);
	window.removeEventListener('pagehide', resetDocumentRuntime);
	document.removeEventListener('visibilitychange', onVisibilityChange);
	resetDocumentRuntime();
}

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

	try {
		const res = await chrome.storage.sync.get([STORAGE_KEY]);
		updateStateSettings(res[STORAGE_KEY]);
	} catch (error: unknown) {
		console.warn('[HALO:Scroll] Failed to restore settings; using defaults', error);
	}

	configure(settings.animationTime, settings.easing, settings.pulseScale);

	let bootTimer = 0;
	let bootPending = false;
	let disposed = false;
	const boot = () => {
		bootPending = false;
		if (disposed) return;
		if (settings.enabled) attachListeners();
	};

	if (document.readyState === 'loading') {
		bootPending = true;
		document.addEventListener('DOMContentLoaded', boot, { once: true });
	} else {
		bootTimer = window.setTimeout(boot, 100);
	}

	const listener = (c: { [key: string]: chrome.storage.StorageChange }, a: string) => {
		if (a === 'sync' && c[STORAGE_KEY]) updateSettings(c[STORAGE_KEY].newValue);
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		disposed = true;
		if (bootPending) document.removeEventListener('DOMContentLoaded', boot);
		if (bootTimer) window.clearTimeout(bootTimer);
		detachListeners();
		chrome.storage.onChanged.removeListener(listener);
		initStarted = false;
	};
}
