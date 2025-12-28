// goal: unified entry point for @nexus/zen-engine package

// Dark mode engine
export {
	enableDarkMode,
	disableDarkMode,
	isDarkModeEnabled,
	toggleDarkMode,
	type DarkModeConfig
} from './dark-mode.js';

// Smooth scroll engine
export {
	enableSmoothScroll,
	disableSmoothScroll,
	isSmoothScrollEnabled
} from './smooth-scroll.js';
