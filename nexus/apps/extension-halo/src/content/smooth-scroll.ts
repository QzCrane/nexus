// goal: Smooth Scroll content script - uses queue-based engine
// inv: No jumping, silky smooth scrolling. Logic split into handlers and state.

import { configure, clearQueue } from '../tools/smooth-scroll/engine';
import { settings, updateStateSettings } from './smooth-scroll-state';
import type { ScrollSettings } from './smooth-scroll-state';
import { onWheel, onKeydown, onMouseDown, onMouseMove, onMouseUp } from './smooth-scroll-handlers';

const LOG_TAG = '[HALO:Scroll]';

export function updateSettings(newSettings: ScrollSettings): void {
	const wasEnabled = settings.enabled;
	updateStateSettings(newSettings);

	configure(settings.animationTime, settings.easing);

	if (newSettings.enabled && !wasEnabled) {
		attachListeners();
	} else if (!newSettings.enabled && wasEnabled) {
		detachListeners();
		clearQueue();
	}

	console.log(LOG_TAG, 'Updated:', newSettings.enabled ? 'ON' : 'OFF');
}

export function attachListeners(): void {
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMouseDown);
	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', onMouseUp);
}

export function detachListeners(): void {
	window.removeEventListener('wheel', onWheel);
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMouseDown);
	window.removeEventListener('mousemove', onMouseMove);
	window.removeEventListener('mouseup', onMouseUp);
}

export async function init(): Promise<void> {
	// Prevent running on extension pages (SidePanel, etc)
	if (window.location.protocol === 'chrome-extension:') {
		return;
	}

	try {
		const result = await chrome.storage.sync.get(['halo_tool_state_smooth-scroll']);
		if (result['halo_tool_state_smooth-scroll']) {
			updateStateSettings(result['halo_tool_state_smooth-scroll']);
		}
	} catch {
		console.log(LOG_TAG, 'Using defaults');
	}

	configure(settings.animationTime, settings.easing);

	if (settings.enabled) {
		attachListeners();
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes['halo_tool_state_smooth-scroll']) {
			updateSettings(changes['halo_tool_state_smooth-scroll'].newValue);
		}
	});


	console.log(LOG_TAG, 'Init');
}
