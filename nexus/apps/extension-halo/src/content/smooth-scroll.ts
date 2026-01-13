// goal: Smooth Scroll content script - uses queue-based engine
// inv: No jumping, silky smooth scrolling. Logic split into handlers and state.

import { configure, clearQueue } from '../tools/smooth-scroll/engine';
import { STORAGE_KEY } from '../tools/smooth-scroll/types';
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
	// rule: Use bubble phase (capture: false) to respect site's stopPropagation/preventDefault
	// inv: passive: false is required to prevent native scrolling
	window.addEventListener('wheel', onWheel, { passive: false, capture: false });
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('mousedown', onMouseDown);
}

export function detachListeners(): void {
	window.removeEventListener('wheel', onWheel, { capture: true });
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('mousedown', onMouseDown);
}

export async function init(): Promise<void> {
	// Prevent running on extension pages (SidePanel, etc)
	if (window.location.protocol === 'chrome-extension:') {
		return;
	}

	try {
		const result = await chrome.storage.sync.get([STORAGE_KEY]);
		if (result[STORAGE_KEY]) {
			updateStateSettings(result[STORAGE_KEY]);
		}
	} catch {
		console.log(LOG_TAG, 'Using defaults');
	}

	configure(settings.animationTime, settings.easing);

	// Delay attaching listeners to ensure site's event handlers are registered first
	// This allows defaultPrevented check to work correctly (e.g., video site space key)
	const delayedAttach = () => {
		if (settings.enabled) {
			attachListeners();
		}
		console.log(LOG_TAG, 'Init');
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', delayedAttach, { once: true });
	} else {
		// Page already loaded, use small delay to ensure site scripts have run
		setTimeout(delayedAttach, 100);
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes[STORAGE_KEY]) {
			updateSettings(changes[STORAGE_KEY].newValue);
		}
	});
}
