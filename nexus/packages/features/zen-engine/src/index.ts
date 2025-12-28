// goal: unified entry point for @nexus/zen-engine package

// Dark mode engine
export {
	enableDarkMode,
	disableDarkMode,
	isDarkModeEnabled,
	toggleDarkMode,
	DARK_MODE_PRESETS,
	type DarkModeConfig,
	type DarkModePreset
} from './dark-mode.js';

// Smooth scroll engine
export {
	enableSmoothScroll,
	disableSmoothScroll,
	isSmoothScrollEnabled
} from './smooth-scroll.js';
