// goal: Hover Zoom content module entry
// eff: Orchestrates initialization and event binding

import { DEFAULT_SETTINGS, STORAGE_KEY } from '../tools/hover-zoom/types';
import { initRulesForHost } from '../tools/hover-zoom/content/resolvers/rule-resolver';
import { createInitialState, createPreloadState } from './hover-zoom-state';
import { createOnOver, createOnOut, createOnMove, createOnClick } from './hover-zoom-events';
import { createOnKeyDown, createOnKeyUp } from './hover-zoom-keys';

const LOG_TAG = '[HALO:HoverZoom]';

// Module state
const state = createInitialState(DEFAULT_SETTINGS);
const preload = createPreloadState();

/**
 * Initialize hover zoom
 */
export async function init(): Promise<void> {
	if (window.location.protocol === 'chrome-extension:') return;
	if (window !== window.top) return;
	if (state.initialized) return;
	state.initialized = true;

	console.log(LOG_TAG, 'Initializing...');

	// Load settings
	try {
		const res = await chrome.storage.local.get(STORAGE_KEY);
		if (res[STORAGE_KEY]) state.settings = { ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] };
	} catch (e) {
		console.warn(LOG_TAG, 'Storage error:', e);
	}

	await initRulesForHost();

	// Create event handlers
	const onOver = createOnOver(state, preload);
	const onOut = createOnOut(state);
	const onMove = createOnMove(state);
	const onClick = createOnClick(state);
	const onKeyDown = createOnKeyDown(state, preload);
	const onKeyUp = createOnKeyUp(state);

	// Mouse events
	document.addEventListener('mouseover', onOver, true);
	document.addEventListener('mouseout', onOut, true);
	document.addEventListener('mousemove', onMove, { passive: true });
	document.addEventListener('click', onClick, true);

	// Keyboard events
	document.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('keyup', onKeyUp, true);

	// Settings sync
	chrome.storage.onChanged.addListener((c, a) => {
		if (a === 'local' && c[STORAGE_KEY]) {
			state.settings = { ...DEFAULT_SETTINGS, ...c[STORAGE_KEY].newValue };
			state.viewer?.updateSettings(state.settings);
			state.hotkeys?.updateSettings(state.settings);
		}
	});

	console.log(LOG_TAG, 'Ready');
}
