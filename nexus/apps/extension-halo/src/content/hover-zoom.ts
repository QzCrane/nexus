// goal: Hover Zoom content module entry
// eff: attach high-frequency page listeners only while the feature is enabled

import { parseHoverZoomSettings } from '../tools/hover-zoom/settings';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../tools/hover-zoom/types';
import { createInitialState, createPreloadState } from './hover-zoom-state';
import {
	cancel,
	clearTriggerTimer,
	createOnClick,
	createOnMove,
	createOnOut,
	createOnOver,
} from './hover-zoom-events';
import { createOnKeyDown, createOnKeyUp } from './hover-zoom-keys';
import { cancelPendingPreviewIntent } from './hover-zoom-runtime-loader';

const LOG_TAG = '[HALO:HoverZoom]';

const state = createInitialState(DEFAULT_SETTINGS);
const preload = createPreloadState();

/** Initialize the light Hover Zoom input host at document_idle. */
export async function init(): Promise<void> {
	if (window.location.protocol === 'chrome-extension:') return;
	if (state.initialized) return;
	state.initialized = true;

	const onOver = createOnOver(state, preload);
	const onOut = createOnOut(state);
	const onMove = createOnMove(state, preload);
	const onClick = createOnClick(state);
	const onKeyDown = createOnKeyDown(state, preload);
	const onKeyUp = createOnKeyUp(state);
	let listenersAttached = false;
	let settingsRevision = 0;

	const attachListeners = (): void => {
		if (listenersAttached || !state.settings.enabled) return;
		listenersAttached = true;
		document.addEventListener('mouseover', onOver, true);
		document.addEventListener('mouseout', onOut, true);
		document.addEventListener('mousemove', onMove, { passive: true });
		document.addEventListener('click', onClick, true);
		document.addEventListener('keydown', onKeyDown, true);
		document.addEventListener('keyup', onKeyUp, true);
	};

	const detachListeners = (): void => {
		cancelPendingPreviewIntent();
		if (listenersAttached) {
			listenersAttached = false;
			document.removeEventListener('mouseover', onOver, true);
			document.removeEventListener('mouseout', onOut, true);
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
			document.removeEventListener('keyup', onKeyUp, true);
		}
		clearTriggerTimer();
		cancel(state);
		state.modifiersActive = false;
		state.currentResourcePref = 'auto';
		preload.pending = null;
		if (preload.preloadImage) preload.preloadImage.src = '';
	};

	const applySettings = (value: unknown): void => {
		settingsRevision += 1;
		cancelPendingPreviewIntent();
		state.settings = parseHoverZoomSettings(value);
		state.viewer?.updateSettings(state.settings);
		if (state.settings.enabled) attachListeners();
		else detachListeners();
	};

	// Subscribe before the asynchronous initial read. A newer storage event owns
	// the setting revision and the delayed snapshot may not resurrect stale
	// high-frequency listeners.
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		const change = changes[STORAGE_KEY];
		if (!change) return;
		applySettings(change.newValue);
	});

	const initialRevision = settingsRevision;
	try {
		const result = await chrome.storage.local.get(STORAGE_KEY);
		if (settingsRevision === initialRevision) applySettings(result[STORAGE_KEY]);
	} catch (error) {
		console.warn(LOG_TAG, 'Storage error:', error);
		if (settingsRevision === initialRevision) applySettings(undefined);
	}
}
