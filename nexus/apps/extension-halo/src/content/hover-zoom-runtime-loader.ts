// goal: keep heavy Hover Zoom preview code out of ordinary document_idle startup
// inv: One document-local import is shared; a retired preview intent can never revive after loading.

import type { HoverZoomState, PreloadState } from './hover-zoom-state';

const LOG_TAG = '[HALO:HoverZoom]';
const RUNTIME_PATH = 'tools/_hover-zoom/runtime.js';

interface HoverZoomPreviewRuntime {
	tryTrigger(
		state: HoverZoomState,
		preload: PreloadState,
		target: HTMLElement,
	): Promise<void>;
}

let runtimePromise: Promise<HoverZoomPreviewRuntime> | null = null;
let previewIntentRevision = 0;

function loadRuntime(): Promise<HoverZoomPreviewRuntime> {
	if (runtimePromise) return runtimePromise;

	const runtimeUrl = chrome.runtime.getURL(RUNTIME_PATH);
	const pending = import(runtimeUrl)
		.then((module: unknown) => {
			if (
				typeof module !== 'object' ||
				module === null ||
				typeof (module as Partial<HoverZoomPreviewRuntime>).tryTrigger !== 'function'
			) {
				throw new Error('HALO Hover Zoom runtime has an invalid module contract');
			}
			return module as HoverZoomPreviewRuntime;
		})
		.catch((error: unknown) => {
			if (runtimePromise === pending) runtimePromise = null;
			throw error;
		});

	runtimePromise = pending;
	return pending;
}

/** Invalidate any trigger waiting on the lazy runtime. */
export function cancelPendingPreviewIntent(): void {
	previewIntentRevision += 1;
}

/**
 * Execute only the latest still-live preview intent after the heavy module is ready.
 * The original input layer remains authoritative for modifier and enablement state.
 */
export async function requestPreview(
	state: HoverZoomState,
	preload: PreloadState,
	target: HTMLElement,
): Promise<void> {
	const revision = ++previewIntentRevision;
	try {
		const runtime = await loadRuntime();
		if (
			revision !== previewIntentRevision ||
			!state.settings.enabled ||
			!state.modifiersActive ||
			!target.isConnected
		) {
			return;
		}
		await runtime.tryTrigger(state, preload, target);
	} catch (error: unknown) {
		if (revision === previewIntentRevision) {
			console.warn(LOG_TAG, 'Lazy preview runtime failed', error);
		}
	}
}
