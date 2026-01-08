// goal: dark-mode module entry (PAUSED - CSP issues)
// risk: darkreader dynamic style injection blocked by strict CSP sites

export {
	enableDarkMode,
	disableDarkMode,
	isDarkModeEnabled,
	toggleDarkMode,
	prewarmDarkReader,
	getGeneratedCSS,
	DARK_MODE_PRESETS,
	DEFAULT_CONFIG,
	DEFAULT_FIXES,
} from './core';

export type {
	DarkModeConfig,
	DarkModeFixes,
	DarkModePreset,
} from './core';

export { DarkModePanel } from './panel';
