// goal: minimal Hover Zoom admission/storage owner before the heavy runtime is needed
// inv: Disabled Hover Zoom owns no page-input listeners; the heavy runtime is never statically imported.

import { DEFAULT_SETTINGS, STORAGE_KEY, type HoverZoomSettings } from '../tools/hover-zoom/types';
import { detectResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';
import type { HoverZoomActivationSnapshot, HoverZoomRuntime } from './hover-zoom';

const LOG_TAG = '[HALO:HoverZoom]';
const RUNTIME_PATH = 'tools/_hover-zoom/runtime.js';

interface RuntimeModule {
	init(settings: HoverZoomSettings): Promise<HoverZoomRuntime>;
}

function savedSettings(value: unknown): Partial<HoverZoomSettings> | undefined {
	return typeof value === 'object' && value !== null ? value as Partial<HoverZoomSettings> : undefined;
}

function mergeSettings(value: Partial<HoverZoomSettings> | undefined): HoverZoomSettings {
	const saved = value ?? {};
	return {
		...DEFAULT_SETTINGS,
		...saved,
		resourceKeys: {
			...DEFAULT_SETTINGS.resourceKeys,
			...(saved.resourceKeys || {}),
			imageKey: { ...DEFAULT_SETTINGS.resourceKeys.imageKey, ...(saved.resourceKeys?.imageKey || {}) },
			videoKey: { ...DEFAULT_SETTINGS.resourceKeys.videoKey, ...(saved.resourceKeys?.videoKey || {}) },
		},
		exemptions: { ...DEFAULT_SETTINGS.exemptions, ...(saved.exemptions || {}) },
		imageInfoItems: { ...DEFAULT_SETTINGS.imageInfoItems, ...(saved.imageInfoItems || {}) },
	};
}

export function initHoverZoomBootstrap(): void {
	if (window.location.protocol === 'chrome-extension:') return;

	let settings = DEFAULT_SETTINGS;
	let lastX = 0;
	let lastY = 0;
	let mouseHasMoved = false;
	let shiftKey = false;
	let ctrlKey = false;
	let altKey = false;
	let source: HoverZoomActivationSnapshot['source'] = 'mousemove';
	let runtime: HoverZoomRuntime | null = null;
	let runtimePromise: Promise<HoverZoomRuntime> | null = null;
	let activationPending = false;
	let inputAttached = false;

	const snapshot = (): HoverZoomActivationSnapshot => ({
		x: lastX, y: lastY, mouseHasMoved, shiftKey, ctrlKey, altKey, source,
	});
	const rememberModifiers = (event: MouseEvent | KeyboardEvent): void => {
		shiftKey = event.shiftKey;
		ctrlKey = event.ctrlKey;
		altKey = event.altKey;
	};

	function detachInput(): void {
		if (!inputAttached) return;
		inputAttached = false;
		document.removeEventListener('mouseover', onMouseOver, true);
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('keydown', onKeyDown, true);
		document.removeEventListener('keyup', onKeyUp, true);
	}
	function attachInput(): void {
		if (inputAttached || runtime || !settings.enabled) return;
		inputAttached = true;
		document.addEventListener('mouseover', onMouseOver, true);
		document.addEventListener('mousemove', onMouseMove, { passive: true });
		document.addEventListener('keydown', onKeyDown, true);
		document.addEventListener('keyup', onKeyUp, true);
	}
	const reconcileInput = (): void => {
		if (settings.enabled && !runtime) attachInput();
		else detachInput();
	};

	const ensureRuntime = (): Promise<HoverZoomRuntime> => {
		if (runtime) return Promise.resolve(runtime);
		if (runtimePromise) return runtimePromise;
		runtimePromise = import(chrome.runtime.getURL(RUNTIME_PATH))
			.then(async (value: unknown) => {
				const module = value as RuntimeModule;
				if (typeof module.init !== 'function') throw new Error('Hover Zoom runtime is missing init()');
				const loaded = await module.init(settings);
				// Publish the owner before the second reconciliation so a concurrent
				// storage event can forward its newer snapshot instead of being lost.
				runtime = loaded;
				await loaded.updateSettings(settings);
				detachInput();
				return loaded;
			})
			.catch((error: unknown) => {
				runtimePromise = null;
				throw error;
			});
		return runtimePromise;
	};

	const requestActivation = (): void => {
		if (!settings.enabled || activationPending) return;
		activationPending = true;
		void ensureRuntime()
			.then((loaded) => loaded.activate(snapshot()))
			.catch((error: unknown) => console.warn(LOG_TAG, 'Runtime activation failed', error))
			.finally(() => { activationPending = false; });
	};

	function onMouseOver(event: MouseEvent): void {
		if (!settings.enabled) return;
		lastX = event.clientX;
		lastY = event.clientY;
		rememberModifiers(event);
		source = 'mouseover';
		if (settings.highlightMode === 'always') requestActivation();
	}
	function onMouseMove(event: MouseEvent): void {
		lastX = event.clientX;
		lastY = event.clientY;
		mouseHasMoved = true;
		rememberModifiers(event);
		source = 'mousemove';
		if (settings.enabled && detectResourcePreference(settings.resourceKeys, event) !== null) requestActivation();
	}
	function onKeyDown(event: KeyboardEvent): void {
		rememberModifiers(event);
		source = 'keydown';
		if (!settings.enabled || event.repeat) return;
		if (detectResourcePreference(settings.resourceKeys, event) === null) return;
		if (event.key === 'Alt' && settings.altKeyMode === 'block') event.preventDefault();
		if (mouseHasMoved) requestActivation();
	}
	function onKeyUp(event: KeyboardEvent): void {
		rememberModifiers(event);
		source = 'keyup';
	}

	void chrome.storage.local.get(STORAGE_KEY)
		.then((result) => {
			settings = mergeSettings(savedSettings(result[STORAGE_KEY]));
			reconcileInput();
		})
		.catch((error: unknown) => {
			console.warn(LOG_TAG, 'Storage error:', error);
			settings = DEFAULT_SETTINGS;
			reconcileInput();
		});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		const change = changes[STORAGE_KEY];
		if (!change) return;
		settings = mergeSettings(savedSettings(change.newValue));
		reconcileInput();
		if (runtime) {
			void runtime.updateSettings(settings).catch((error: unknown) => {
				console.warn(LOG_TAG, 'Settings update failed', error);
			});
		}
	});
}
