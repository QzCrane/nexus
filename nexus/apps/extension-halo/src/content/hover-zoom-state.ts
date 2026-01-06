// goal: Hover Zoom state management
// eff: Centralized state for hover zoom content script

import type { HoverZoomSettings } from '../tools/hover-zoom/types';
import type { HoverZoomViewer } from '../tools/hover-zoom/content/viewer/index';
import type { HotkeyManager } from '../tools/hover-zoom/content/utils/hotkeys';
import type { ResourcePreference } from '../tools/hover-zoom/content/utils/resource-key-helper';

/**
 * Hover zoom state - all mutable state in one place
 */
export interface HoverZoomState {
	initialized: boolean;
	viewer: HoverZoomViewer | null;
	hotkeys: HotkeyManager | null;
	settings: HoverZoomSettings;
	currentTarget: HTMLElement | null;
	hoverTimer: number | null;
	lastX: number;
	lastY: number;
	mouseHasMoved: boolean;
	modifiersActive: boolean;
	toggleLocked: boolean;
	currentResourcePref: ResourcePreference;
}

/**
 * Preload cache state
 */
export interface PreloadState {
	cache: WeakMap<HTMLElement, { result: any; url: string; pref: ResourcePreference }>;
	pending: HTMLElement | null;
	preloadImage: HTMLImageElement | null;
}

/**
 * Create initial hover zoom state
 */
export function createInitialState(settings: HoverZoomSettings): HoverZoomState {
	return {
		initialized: false,
		viewer: null,
		hotkeys: null,
		settings,
		currentTarget: null,
		hoverTimer: null,
		lastX: 0,
		lastY: 0,
		mouseHasMoved: false,
		modifiersActive: false,
		toggleLocked: false,
		currentResourcePref: 'auto'
	};
}

/**
 * Create initial preload state
 */
export function createPreloadState(): PreloadState {
	return {
		cache: new WeakMap(),
		pending: null,
		preloadImage: null
	};
}
