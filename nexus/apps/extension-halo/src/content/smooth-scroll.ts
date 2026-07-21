// goal: Smooth Scroll content script
// inv: Logic split into handlers and state

import { configure, clearQueue } from '../tools/smooth-scroll/engine';
import { STORAGE_KEY } from '../tools/smooth-scroll/types';
import { settings, updateStateSettings } from './smooth-scroll-state';
import type { ScrollSettings } from './smooth-scroll-state';
import { onWheel, onKeydown, onMouseDown } from './smooth-scroll-handlers';

export const updateSettings = (n: ScrollSettings): void => {
	const was = settings.enabled;
	updateStateSettings(n);
	configure(settings.animationTime, settings.easing);

	if (n.enabled && !was) attachListeners();
	else if (!n.enabled && was) { detachListeners(); clearQueue(); }

	console.log('[HALO:Scroll] Updated:', n.enabled ? 'ON' : 'OFF');
}

export const attachListeners = () => {
	window.addEventListener('wheel', onWheel, { passive: false, capture: true });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMouseDown);
}

export const detachListeners = () => {
	window.removeEventListener('wheel', onWheel, { capture: true });
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMouseDown);
}

// rule: guard against double-init and return a cleanup function so callers (e.g.
// tests, hot reload) can detach the storage listener. Without the guard, repeated
// init() calls would stack N storage.onChanged listeners that each called
// updateSettings, amplifying one storage write into N updates.
let initStarted = false;
export async function init(): Promise<() => void> {
	if (initStarted) return () => {};
	initStarted = true;

	if (location.protocol === 'chrome-extension:') return () => {};

	try {
		const res = await chrome.storage.sync.get([STORAGE_KEY]);
		if (res[STORAGE_KEY]) updateStateSettings(res[STORAGE_KEY]);
	} catch { console.log('[HALO:Scroll] Defaults'); }

	configure(settings.animationTime, settings.easing);

	const boot = () => {
		if (settings.enabled) attachListeners();
		console.log('[HALO:Scroll] Init');
	};

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
	else setTimeout(boot, 100);

	const listener = (c: { [key: string]: chrome.storage.StorageChange }, a: string) => {
		if (a === 'sync' && c[STORAGE_KEY]) updateSettings(c[STORAGE_KEY].newValue);
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		chrome.storage.onChanged.removeListener(listener);
		initStarted = false;
	};
}
