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

	// Save bounds when window is resized/moved (debounced via onRemoved cleanup)
	const windowId = createdWindow.id;
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;

	const saveBounds = async (changedWindow: chrome.windows.Window) => {
		if (changedWindow.id !== windowId) return;

		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
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

	// Use onBoundsChanged if available (Chrome 86+)
	if (chrome.windows.onBoundsChanged) {
		chrome.windows.onBoundsChanged.addListener(saveBounds);
	}
}
