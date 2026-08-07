// goal: Hover Zoom content module entry
// eff: attach high-frequency page listeners only while the feature is enabled

import { DEFAULT_SETTINGS, STORAGE_KEY, type HoverZoomSettings } from '../tools/hover-zoom/types';
import { initRulesForHost } from '../tools/hover-zoom/content/resolvers/rule-resolver';
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

const LOG_TAG = '[HALO:HoverZoom]';

// Module state
const state = createInitialState(DEFAULT_SETTINGS);
const preload = createPreloadState();

/** Deep merge settings with defaults to handle nested objects like resourceKeys. */
function mergeSettings(saved: Partial<HoverZoomSettings> | undefined): HoverZoomSettings {
	const value = saved ?? {};
	return {
		...DEFAULT_SETTINGS,
		...value,
		resourceKeys: {
			...DEFAULT_SETTINGS.resourceKeys,
			...(value.resourceKeys || {}),
			imageKey: {
				...DEFAULT_SETTINGS.resourceKeys.imageKey,
				...(value.resourceKeys?.imageKey || {}),
			},
			videoKey: {
				...DEFAULT_SETTINGS.resourceKeys.videoKey,
				...(value.resourceKeys?.videoKey || {}),
			},
		},
		exemptions: {
			...DEFAULT_SETTINGS.exemptions,
			...(value.exemptions || {}),
		},
		imageInfoItems: {
			...DEFAULT_SETTINGS.imageInfoItems,
			...(value.imageInfoItems || {}),
		},
	};
}

function savedSettings(value: unknown): Partial<HoverZoomSettings> | undefined {
	return typeof value === 'object' && value !== null
		? value as Partial<HoverZoomSettings>
		: undefined;
}

/** Initialize hover zoom. This entry is loaded top-frame at document_idle. */
export async function init(): Promise<void> {
	if (window.location.protocol === 'chrome-extension:') return;
	if (state.initialized) return;
	state.initialized = true;

	try {
		const result = await chrome.storage.local.get(STORAGE_KEY);
		state.settings = mergeSettings(savedSettings(result[STORAGE_KEY]));
	} catch (error) {
		console.warn(LOG_TAG, 'Storage error:', error);
	}

	// Currently a no-op compatibility seam, but keep it in the activation path
	// so a future rule-engine bootstrap cannot accidentally run for disabled users.
	await initRulesForHost();

	const onOver = createOnOver(state, preload);
	const onOut = createOnOut(state);
	const onMove = createOnMove(state, preload);
	const onClick = createOnClick(state);
	const onKeyDown = createOnKeyDown(state, preload);
	const onKeyUp = createOnKeyUp(state);
	let listenersAttached = false;

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
		if (!listenersAttached) return;
		listenersAttached = false;
		document.removeEventListener('mouseover', onOver, true);
		document.removeEventListener('mouseout', onOut, true);
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('click', onClick, true);
		document.removeEventListener('keydown', onKeyDown, true);
		document.removeEventListener('keyup', onKeyUp, true);
		clearTriggerTimer();
		cancel(state);
		state.modifiersActive = false;
		state.currentResourcePref = 'auto';
		preload.pending = null;
		if (preload.preloadImage) preload.preloadImage.src = '';
	};

	attachListeners();

	// Keep only the low-frequency settings subscription alive while disabled.
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		const change = changes[STORAGE_KEY];
		if (!change) return;

		state.settings = mergeSettings(savedSettings(change.newValue));
		state.viewer?.updateSettings(state.settings);
		if (state.settings.enabled) attachListeners();
		else detachListeners();
	});
}
