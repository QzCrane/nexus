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

let settingsHydrated = false;
let observationListenersAttached = false;
let activeInputListenersAttached = false;

const resetDocumentRuntime = (): void => {
	clearQueue();
	resetInputHandlers();
	resetRuntimeState();
};

const onVisibilityChange = (): void => {
	if (document.hidden) resetDocumentRuntime();
};

const onObservedKeydown = (event: KeyboardEvent): void => {
	// The capture observer is registered at document_start, but it remains
	// inert until storage hydration proves that the tool is enabled. This keeps
	// pre-site event order without transiently overriding a stored disabled state.
	if (!settingsHydrated || !settings.enabled) return;
	onKeydownCapture(event);
};

const onObservedKeyup = (event: KeyboardEvent): void => {
	if (!settingsHydrated) return;
	onKeyup(event);
};

const attachObservationListeners = (): void => {
	if (observationListenersAttached) return;
	observationListenersAttached = true;
	window.addEventListener('keydown', onObservedKeydown, true);
	window.addEventListener('keyup', onObservedKeyup, true);
	window.addEventListener('blur', resetDocumentRuntime);
	window.addEventListener('pagehide', resetDocumentRuntime);
	document.addEventListener('visibilitychange', onVisibilityChange);
};

const detachObservationListeners = (): void => {
	if (!observationListenersAttached) return;
	observationListenersAttached = false;
	window.removeEventListener('keydown', onObservedKeydown, true);
	window.removeEventListener('keyup', onObservedKeyup, true);
	window.removeEventListener('blur', resetDocumentRuntime);
	window.removeEventListener('pagehide', resetDocumentRuntime);
	document.removeEventListener('visibilitychange', onVisibilityChange);
	resetDocumentRuntime();
};

const attachActiveInputListeners = (): void => {
	if (activeInputListenersAttached) return;
	activeInputListenersAttached = true;
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('mousedown', onMouseDown);
};

const detachActiveInputListeners = (): void => {
	if (!activeInputListenersAttached) return;
	activeInputListenersAttached = false;
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('mousedown', onMouseDown);
	resetDocumentRuntime();
};

const updateSettings = (value: unknown): void => {
	const wasEnabled = settings.enabled;
	const next = updateStateSettings(value);
	configure(next.animationTime, next.easing, next.pulseScale);

	if (!settingsHydrated) return;
	if (next.enabled && !wasEnabled) attachActiveInputListeners();
	else if (!next.enabled && wasEnabled) detachActiveInputListeners();
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
	// Register the observation seam before the first await. The observer does
	// not act until settingsHydrated becomes true, so registration order and
	// persisted enablement are both preserved.
	attachObservationListeners();

	let hydrationRevision = 0;
	const listener = (
		changes: { [key: string]: chrome.storage.StorageChange },
		areaName: string,
	): void => {
		if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
		hydrationRevision++;
		updateSettings(changes[STORAGE_KEY].newValue);
	};
	chrome.storage.onChanged.addListener(listener);

	const revisionBeforeRestore = hydrationRevision;
	try {
		const result = await chrome.storage.sync.get([STORAGE_KEY]);
		// A live storage event that arrives during hydration is newer than the
		// get() snapshot and must win instead of being overwritten by stale data.
		if (hydrationRevision === revisionBeforeRestore) {
			updateSettings(result[STORAGE_KEY]);
		}
	} catch (error: unknown) {
		console.warn('[HALO:Scroll] Failed to restore settings; using defaults', error);
	}

	settingsHydrated = true;
	if (settings.enabled) attachActiveInputListeners();
	console.log('[HALO:Scroll] Ready');

	return () => {
		settingsHydrated = false;
		detachActiveInputListeners();
		detachObservationListeners();
		chrome.storage.onChanged.removeListener(listener);
		initStarted = false;
	};
}
