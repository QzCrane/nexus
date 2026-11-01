// goal: manages the application's appearance by handling explicit and system-preferred theme switching

import type { ThemeMode } from '@nexus/contracts';
import { THEME_MODE_KEY } from '../../shared/popup-bootstrap';

const THEME_ATTRIBUTE = 'data-theme';
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

let systemMediaQuery: MediaQueryList | null = null;
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

// eff: updates the document's theme attribute and attaches/detaches system-level color scheme listeners
export function applyTheme(mode: ThemeMode): void {
	removeSystemThemeListener();

	if (mode === 'system') {
		systemMediaQuery = window.matchMedia(DARK_MODE_QUERY);
		const currentTheme = systemMediaQuery.matches ? 'dark' : 'light';
		document.documentElement.setAttribute(THEME_ATTRIBUTE, currentTheme);

		// rule: when in 'system' mode, react immediately to OS-level theme changes
		systemThemeListener = (e: MediaQueryListEvent) => {
			document.documentElement.setAttribute(THEME_ATTRIBUTE, e.matches ? 'dark' : 'light');
		};
		systemMediaQuery.addEventListener('change', systemThemeListener);
	} else {
		document.documentElement.setAttribute(THEME_ATTRIBUTE, mode);
	}
	// The mode, not the resolved colour: `system` has to stay resolvable by the
	// head script's own media query, or a Popup opened after an OS theme change
	// would paint the colour that change replaced. This is the only authority the
	// first paint has - settings arrive after it.
	persistThemeMode(mode);
}

function persistThemeMode(mode: ThemeMode): void {
	try {
		window.localStorage.setItem(THEME_MODE_KEY, mode);
	} catch (error) {
		// A denied storage area costs the next open one theme repaint.
		console.debug('[SPECTRA Popup] Theme mode not persisted:', error);
	}
}

// eff: cleans up media query listeners to prevent redundant attribute updates when switching to a fixed theme
function removeSystemThemeListener(): void {
	if (systemMediaQuery && systemThemeListener) {
		systemMediaQuery.removeEventListener('change', systemThemeListener);
		systemThemeListener = null;
		systemMediaQuery = null;
	}
}

export function getEffectiveTheme(): 'light' | 'dark' {
	const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
	return attr === 'dark' ? 'dark' : 'light';
}

export const THEME_ICONS: Record<ThemeMode, string> = {
	light: '☀️',
	dark: '🌙',
	system: '🖥️'
};

// post: returns the next theme in the rotation: Light -> Dark -> System
export function getNextThemeMode(current: ThemeMode): ThemeMode {
	const modes: ThemeMode[] = ['light', 'dark', 'system'];
	const idx = modes.indexOf(current);
	return modes[(idx + 1) % modes.length] ?? 'system';
}
