// goal: Smooth Scroll content script
// inv: packaged-module install authority and feature settings must both allow input ownership

import { clearQueue, configure } from '../tools/smooth-scroll/engine';
import { STORAGE_KEY } from '../tools/smooth-scroll/types';
import {
	moduleInstallationStorageKey,
	readOptionalPackagedModuleChangeEnabled,
	readOptionalPackagedModuleEnabled,
} from '../kernel/core/module-installation-runtime';
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

const MODULE_ID = 'smooth-scroll';
const MODULE_STORAGE_KEY = moduleInstallationStorageKey(MODULE_ID);

let settingsHydrated = false;
let moduleHydrated = false;
let moduleEnabled = false;
let observationListenersAttached = false;
let activeInputListenersAttached = false;

const runtimeEnabled = (): boolean => (
	settingsHydrated && moduleHydrated && moduleEnabled && settings.enabled
);

const resetDocumentRuntime = (): void => {
	clearQueue();
	resetInputHandlers();
	resetRuntimeState();
};

const onVisibilityChange = (): void => {
	if (document.hidden) resetDocumentRuntime();
};

const onObservedKeydown = (event: KeyboardEvent): void => {
	// The capture observer is registered at document_start so reinstalling the
	// packaged module does not create a late listener-order variant. It remains
	// inert until both persistent authorities prove input ownership is enabled.
	if (!runtimeEnabled()) return;
	onKeydownCapture(event);
};

const onObservedKeyup = (event: KeyboardEvent): void => {
	if (!runtimeEnabled()) return;
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

const reconcileInputOwnership = (): void => {
	if (runtimeEnabled()) attachActiveInputListeners();
	else detachActiveInputListeners();
};

const updateSettings = (value: unknown): void => {
	const next = updateStateSettings(value);
	configure(next.animationTime, next.easing, next.pulseScale);
	reconcileInputOwnership();
};

const updateModuleEnabled = (enabled: boolean): void => {
	if (moduleEnabled === enabled && moduleHydrated) return;
	moduleEnabled = enabled;
	moduleHydrated = true;
	reconcileInputOwnership();
};

let initStarted = false;
export async function init(): Promise<() => void> {
	if (initStarted) return () => {};
	initStarted = true;

	if (window !== window.top || location.protocol === 'chrome-extension:') {
		initStarted = false;
		return () => {};
	}

	configure(settings.animationTime, settings.easing, settings.pulseScale);
	attachObservationListeners();

	let settingsRevision = 0;
	let moduleRevision = 0;
	const listener = (
		changes: { [key: string]: chrome.storage.StorageChange },
		areaName: string,
	): void => {
		if (areaName === 'sync' && changes[STORAGE_KEY]) {
			settingsRevision += 1;
			settingsHydrated = true;
			updateSettings(changes[STORAGE_KEY].newValue);
			return;
		}
		if (areaName === 'local' && changes[MODULE_STORAGE_KEY]) {
			moduleRevision += 1;
			updateModuleEnabled(
				readOptionalPackagedModuleChangeEnabled(changes[MODULE_STORAGE_KEY]),
			);
		}
	};
	chrome.storage.onChanged.addListener(listener);

	const settingsRevisionBeforeHydration = settingsRevision;
	const moduleRevisionBeforeHydration = moduleRevision;
	const [settingsResult, moduleResult] = await Promise.allSettled([
		chrome.storage.sync.get([STORAGE_KEY]),
		readOptionalPackagedModuleEnabled(MODULE_ID),
	]);

	if (settingsRevision === settingsRevisionBeforeHydration) {
		settingsHydrated = true;
		if (settingsResult.status === 'fulfilled') updateSettings(settingsResult.value[STORAGE_KEY]);
		else {
			console.warn('[HALO:Scroll] Failed to restore settings; disabling input ownership', settingsResult.reason);
			updateSettings({ ...settings, enabled: false });
		}
	}
	if (moduleRevision === moduleRevisionBeforeHydration) {
		if (moduleResult.status === 'fulfilled') updateModuleEnabled(moduleResult.value);
		else {
			console.warn('[HALO:Scroll] Failed to restore module installation; disabling input ownership', moduleResult.reason);
			updateModuleEnabled(false);
		}
	}

	reconcileInputOwnership();
	console.log('[HALO:Scroll] Ready');

	return () => {
		settingsHydrated = false;
		moduleHydrated = false;
		moduleEnabled = false;
		detachActiveInputListeners();
		detachObservationListeners();
		chrome.storage.onChanged.removeListener(listener);
		initStarted = false;
	};
}
