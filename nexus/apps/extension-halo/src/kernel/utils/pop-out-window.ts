// goal: Create standalone popup window for HALO tools
// eff: Allows using HALO as a detached app-like window

import { createLogger } from '@nexus/kernel';

const logger = createLogger('PopOutWindow', 'HALO');

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 700;
const STORAGE_KEY = 'halo_popout_bounds';

interface WindowBounds {
	width: number;
	height: number;
	left?: number;
	top?: number;
}

// rule: track the active bounds-changed listener and its owning window id so we
// can remove the previous listener before adding a new one (and on window close).
// Previously each popOutWindow() call added a fresh listener without removing
// the old one — listeners accumulated indefinitely, each holding a stale closure
// over its own windowId/saveTimeout and silently writing bounds for a closed
// window or fighting over chrome.storage.local writes.
let activeBoundsListener: ((w: chrome.windows.Window) => void) | null = null;
let activeRemovedListener: ((closedId: number) => void) | null = null;
let activeSaveTimeout: ReturnType<typeof setTimeout> | null = null;

function detachBoundsListener(): void {
	if (activeBoundsListener && chrome.windows.onBoundsChanged) {
		chrome.windows.onBoundsChanged.removeListener(activeBoundsListener);
	}
	if (activeRemovedListener && chrome.windows.onRemoved) {
		// rule: chrome-types has a known defect where ChromeEvent.removeListener
		// is typed as the full addListener overload (callback, filters?) which
		// (closedId: number) => void does not match. Runtime accepts the simpler
		// callback form, so a double `as unknown as` assertion is required to
		// escape the overloaded signature.
		(chrome.windows.onRemoved.removeListener as unknown as (cb: (windowId: number) => void) => void)(
			activeRemovedListener,
		);
	}
	if (activeSaveTimeout) {
		clearTimeout(activeSaveTimeout);
		activeSaveTimeout = null;
	}
	activeBoundsListener = null;
	activeRemovedListener = null;
}

/**
 * Open HALO in a standalone popup window
 * - Window persists until user closes it
 * - Position/size is remembered across sessions
 */
export async function popOutWindow(): Promise<void> {
	// Check if already has a popout window open
	const existingWindows = await chrome.windows.getAll({ windowTypes: ['popup'] });
	const haloWindow = existingWindows.find(w =>
		w.id && w.tabs?.some(t => t.url?.includes('sidepanel.html'))
	);

	if (haloWindow?.id) {
		// Focus existing window instead of creating new one
		await chrome.windows.update(haloWindow.id, { focused: true });
		logger.info('Focused existing HALO window');
		return;
	}

	// Load saved bounds or use defaults
	let bounds: WindowBounds = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
	try {
		const stored = await chrome.storage.local.get(STORAGE_KEY);
		if (stored[STORAGE_KEY]) {
			bounds = { ...bounds, ...stored[STORAGE_KEY] };
		}
	} catch (e) {
		logger.warn('Failed to load window bounds:', e);
	}

	// Create popup window
	const sidepanelUrl = chrome.runtime.getURL('sidepanel.html');

	const createdWindow = await chrome.windows.create({
		url: sidepanelUrl,
		type: 'popup',
		width: bounds.width,
		height: bounds.height,
		left: bounds.left,
		top: bounds.top,
		focused: true,
	});

	if (!createdWindow?.id) {
		logger.warn('Failed to create popup window');
		return;
	}

	logger.info('Created HALO popup window:', createdWindow.id);

	// rule: drop any previous listener before installing a new one. Without this,
	// repeated popOutWindow() calls (e.g., user closes popout, opens again) would
	// stack listeners and the stale ones would keep firing for the dead windowId.
	detachBoundsListener();

	const windowId = createdWindow.id;

	const saveBounds = async (changedWindow: chrome.windows.Window) => {
		if (changedWindow.id !== windowId) return;

		if (activeSaveTimeout) clearTimeout(activeSaveTimeout);
		activeSaveTimeout = setTimeout(async () => {
			activeSaveTimeout = null;
			try {
				const w = await chrome.windows.get(windowId);
				if (w.width && w.height) {
					const newBounds: WindowBounds = {
						width: w.width,
						height: w.height,
						left: w.left,
						top: w.top,
					};
					await chrome.storage.local.set({ [STORAGE_KEY]: newBounds });
				}
			} catch {
				// Window might be closed
			}
		}, 500);
	};

	// rule: also clean up when the popout itself is closed so we don't leak a
	// listener that fires forever for a window that no longer exists.
	const onRemovedHandler = (closedId: number) => {
		if (closedId !== windowId) return;
		detachBoundsListener();
	};

	// Use onBoundsChanged if available (Chrome 86+)
	if (chrome.windows.onBoundsChanged) {
		chrome.windows.onBoundsChanged.addListener(saveBounds);
		activeBoundsListener = saveBounds;
		if (chrome.windows.onRemoved) {
			chrome.windows.onRemoved.addListener(onRemovedHandler);
			activeRemovedListener = onRemovedHandler;
		}
	}
}
