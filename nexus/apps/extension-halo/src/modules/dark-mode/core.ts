// goal: high-quality dark mode via darkreader with full API exposure
// tradeoff: accept darkreader's algorithm, expose all config for UI control
// ban: filter:invert (X-ray), pure CSS (low coverage)

import {
	enable as drEnable,
	disable as drDisable,
	isEnabled as drIsEnabled,
	setFetchMethod,
	exportGeneratedCSS,
} from 'darkreader';

const CACHE_KEY = 'halo-dark-mode-cache';

// eff: full theme config matching darkreader's API
export interface DarkModeConfig {
	brightness: number;      // 0-200, default 100
	contrast: number;        // 0-200, default 100
	sepia: number;           // 0-100, default 0
	grayscale: number;       // 0-100, default 0
	darkSchemeBackgroundColor: string;  // default '#181a1b'
	darkSchemeTextColor: string;        // default '#e8e6e3'
	scrollbarColor: string;             // default 'auto'
	selectionColor: string;             // default 'auto'
	styleSystemControls: boolean;       // default true
}

// eff: fixes config for site-specific adjustments
export interface DarkModeFixes {
	invert: string[];
	css: string;
	ignoreInlineStyle: string[];
	ignoreImageAnalysis: string[];
	disableStyleSheetsProxy: boolean;
}

export const DEFAULT_CONFIG: DarkModeConfig = {
	brightness: 100,
	contrast: 100,
	sepia: 10,
	grayscale: 0,
	darkSchemeBackgroundColor: '#181818',
	darkSchemeTextColor: '#e8e6e3',
	scrollbarColor: '#454a4d',
	selectionColor: '#005ccc',
	styleSystemControls: true,
};

export const DEFAULT_FIXES: DarkModeFixes = {
	invert: [],
	css: '',
	ignoreInlineStyle: ['[class*="icon"]', '[class*="Icon"]'],
	ignoreImageAnalysis: ['[class*="cover"]', '[class*="thumb"]'],
	disableStyleSheetsProxy: true, // inv: avoid CSP violations on strict sites like Bilibili
};

// eff: cached fetch with error handling
// inv: caches API may not be available in all contexts (e.g., some content scripts)
const cachedFetch = async (url: string): Promise<Response> => {
	// Check if caches API is available
	if (typeof caches === 'undefined') {
		return fetch(url);
	}
	try {
		const cache = await caches.open(CACHE_KEY);
		const cached = await cache.match(url);
		if (cached) return cached;
		const response = await fetch(url);
		if (response.ok) cache.put(url, response.clone());
		return response;
	} catch {
		return fetch(url);
	}
};

let initialized = false;
function initDarkReader(): void {
	if (initialized) return;
	setFetchMethod(cachedFetch);
	initialized = true;
}

// eff: prewarm darkreader early (before enable is called)
// This reduces perceived latency by setting up fetch method in advance
export function prewarmDarkReader(): void {
	initDarkReader();
}

export function enableDarkMode(
	config: Partial<DarkModeConfig> = {},
	fixes: Partial<DarkModeFixes> = {}
): void {
	initDarkReader();
	const mergedConfig = { ...DEFAULT_CONFIG, ...config };
	const mergedFixes = { ...DEFAULT_FIXES, ...fixes };
	drEnable(mergedConfig, mergedFixes);
	document.documentElement.classList.add('halo-dark-mode');
}

export function disableDarkMode(): void {
	drDisable();
	document.documentElement.classList.remove('halo-dark-mode');
}

export function isDarkModeEnabled(): boolean {
	return drIsEnabled();
}

export function toggleDarkMode(config?: Partial<DarkModeConfig>): boolean {
	if (isDarkModeEnabled()) { disableDarkMode(); return false; }
	enableDarkMode(config);
	return true;
}

// eff: export generated CSS for caching/debugging
export async function getGeneratedCSS(): Promise<string> {
	return exportGeneratedCSS();
}

// eff: presets for quick selection
export const DARK_MODE_PRESETS = {
	default: { brightness: 100, contrast: 100, sepia: 10, grayscale: 0 },
	highContrast: { brightness: 90, contrast: 110, sepia: 0, grayscale: 0 },
	warm: { brightness: 100, contrast: 100, sepia: 25, grayscale: 0 },
	dim: { brightness: 80, contrast: 90, sepia: 0, grayscale: 0 },
} as const;

export type DarkModePreset = keyof typeof DARK_MODE_PRESETS;
