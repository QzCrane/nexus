// goal: minimal top-frame Hover Zoom bootstrap; heavy runtime loads only after relevant user input
// inv: Storage is the single settings authority; disabled Hover Zoom owns no page-input listeners.

import {
	DEFAULT_SETTINGS,
	STORAGE_KEY,
	type HoverZoomSettings,
} from '../tools/hover-zoom/types';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import type {
	HoverZoomActivationSnapshot,
	HoverZoomRuntime,
} from '../content/hover-zoom';

const LOG_TAG = '[HALO:HoverZoom]';
const RUNTIME_PATH = 'tools/_hover-zoom/runtime.js';

interface HoverZoomRuntimeModule {
	init(settings: HoverZoomSettings): Promise<HoverZoomRuntime>;
}

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

if (window.location.protocol !== 'chrome-extension:') {
	let settings = DEFAULT_SETTINGS;
	let lastX = 0;
	let lastY = 0;
	let mouseHasMoved = false;
	let shiftKey = false;
	let ctrlKey = false;
	let altKey = false;
	let lastSource: HoverZoomActivationSnapshot['source'] = 'mousemove';
	let runtime: HoverZoomRuntime | null = null;
	let runtimePromise: Promise<HoverZoomRuntime> | null = null;
	let activationPending = false;
	let inputListenersAttached = false;

	const snapshot = (): HoverZoomActivationSnapshot => ({
		x: lastX,
		y: lastY,
		mouseHasMoved,
		shiftKey,
		ctrlKey,
		altKey,
		source: lastSource,
	});

	const rememberModifiers = (event: MouseEvent | KeyboardEvent): void => {
		shiftKey = event.shiftKey;
		ctrlKey = event.ctrlKey;
		altKey = event.altKey;
	};

	const detachInputListeners = (): void => {
		if (!inputListenersAttached) return;
		inputListenersAttached = false;
		document.removeEventListener('mouseover', onMouseOver, true);
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('keydown', onKeyDown, true);
		document.removeEventListener('keyup', onKeyUp, true);
	};

	const attachInputListeners = (): void => {
		if (inputListenersAttached || runtime || !settings.enabled) return;
		inputListenersAttached = true;
		document.addEventListener('mouseover', onMouseOver, true);
		document.addEventListener('mousemove', onMouseMove, { passive: true });
		document.addEventListener('keydown', onKeyDown, true);
		document.addEventListener('keyup', onKeyUp, true);
	};

	const reconcileInputListeners = (): void => {
		if (settings.enabled && !runtime) attachInputListeners();
		else detachInputListeners();
	};

	const ensureRuntime = (): Promise<HoverZoomRuntime> => {
		if (runtime) return Promise.resolve(runtime);
		if (runtimePromise) return runtimePromise;

		const runtimeUrl = chrome.runtime.getURL(RUNTIME_PATH);
		runtimePromise = import(runtimeUrl)
			.then(async (moduleValue: unknown) => {
				const module = moduleValue as HoverZoomRuntimeModule;
				if (typeof module.init !== 'function') {
					throw new Error('Hover Zoom runtime is missing init()');
				}
				const loaded = await module.init(settings);
				runtime = loaded;
				detachInputListeners();
				return loaded;
			})
			.catch((error: unknown) => {
				runtimePromise = null;
				throw error;
			});
		return runtimePromise;
	};

	const activateRuntime = (): void => {
		if (!settings.enabled || activationPending) return;
		activationPending = true;
		void ensureRuntime()
			.then((loaded) => loaded.activate(snapshot()))
			.catch((error: unknown) => {
				console.warn(LOG_TAG, 'Runtime activation failed', error);
			})
			.finally(() => {
				activationPending = false;
			});
	};

	function onMouseOver(event: MouseEvent): void {
		if (!settings.enabled) return;
		lastX = event.clientX;
		lastY = event.clientY;
		rememberModifiers(event);
		lastSource = 'mouseover';
		if (settings.highlightMode === 'always') activateRuntime();
	}

	function onMouseMove(event: MouseEvent): void {
		lastX = event.clientX;
		lastY = event.clientY;
		mouseHasMoved = true;
		rememberModifiers(event);
		lastSource = 'mousemove';
		if (!settings.enabled) return;
		if (detectResourcePreference(settings.resourceKeys, event) !== null) activateRuntime();
	}

	function onKeyDown(event: KeyboardEvent): void {
		rememberModifiers(event);
		lastSource = 'keydown';
		if (!settings.enabled || event.repeat) return;

		const resourcePref = detectResourcePreference(settings.resourceKeys, event);
		if (resourcePref === null) return;
		if (event.key === 'Alt' && settings.altKeyMode === 'block') event.preventDefault();
		if (mouseHasMoved) activateRuntime();
	}

	function onKeyUp(event: KeyboardEvent): void {
		rememberModifiers(event);
		lastSource = 'keyup';
	}

	void chrome.storage.local.get(STORAGE_KEY)
		.then((result) => {
			settings = mergeSettings(savedSettings(result[STORAGE_KEY]));
			reconcileInputListeners();
		})
		.catch((error: unknown) => {
			console.warn(LOG_TAG, 'Storage error:', error);
			settings = DEFAULT_SETTINGS;
			reconcileInputListeners();
		});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		const change = changes[STORAGE_KEY];
		if (!change) return;

		settings = mergeSettings(savedSettings(change.newValue));
		reconcileInputListeners();
		if (runtime) {
			void runtime.updateSettings(settings).catch((error: unknown) => {
				console.warn(LOG_TAG, 'Settings update failed', error);
			});
		}
	});
}
