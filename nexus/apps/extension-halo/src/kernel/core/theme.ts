// goal: Theme system with CSS variables

import { THEME_SURFACES } from './theme-palette';
import type { ThemeMode, HaloSettings } from './settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from './settings';
import { safeStorageGet, safeStorageSet } from './safe-storage';

export interface ThemeColors {
	bg: string;
	bgSecondary: string;
	bgTertiary: string;
	text: string;
	textSecondary: string;
	textMuted: string;
	border: string;
	accent: string;
	accentHover: string;
	success: string;
	error: string;
	// Premium UI Tokens
	cardBg: string; // For glassmorphism/cards
	glassBorder: string; // Subtle border for glass
	shadow: string; // Standard elevation
}

const DARK_THEME: ThemeColors = {
	...THEME_SURFACES.dark,
	accent: '#7c3aed',
	accentHover: '#8b5cf6',
	success: '#22c55e',
	error: '#ef4444',
	cardBg: 'rgba(255, 255, 255, 0.03)',
	glassBorder: 'rgba(255, 255, 255, 0.08)',
	shadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
};

const LIGHT_THEME: ThemeColors = {
	...THEME_SURFACES.light,
	accent: '#7c3aed',
	accentHover: '#6d28d9',
	success: '#16a34a',
	error: '#dc2626',
	cardBg: '#ffffff',
	glassBorder: 'rgba(0, 0, 0, 0.06)',
	shadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
};

/**
 * Get theme colors based on mode
 */
export function getThemeColors(mode: ThemeMode, accentColor: string): ThemeColors {
	const isDark = mode === 'dark' ||
		(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

	const base = isDark ? DARK_THEME : LIGHT_THEME;
	return {
		...base,
		accent: accentColor,
		accentHover: adjustBrightness(accentColor, isDark ? 20 : -20),
	};
}

/**
 * Adjust color brightness
 */
function adjustBrightness(hex: string, percent: number): string {
	const num = parseInt(hex.replace('#', ''), 16);
	const amt = Math.round(2.55 * percent);
	const R = Math.min(255, Math.max(0, (num >> 16) + amt));
	const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
	const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
	return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

/**
 * Apply theme to document
 */
export function applyTheme(colors: ThemeColors): void {
	const root = document.documentElement;
	root.style.setProperty('--halo-bg', colors.bg);
	root.style.setProperty('--halo-bg-secondary', colors.bgSecondary);
	root.style.setProperty('--halo-bg-tertiary', colors.bgTertiary);
	root.style.setProperty('--halo-text', colors.text);
	root.style.setProperty('--halo-text-secondary', colors.textSecondary);
	root.style.setProperty('--halo-text-muted', colors.textMuted);
	root.style.setProperty('--halo-border', colors.border);
	root.style.setProperty('--halo-accent', colors.accent);
	root.style.setProperty('--halo-accent-hover', colors.accentHover);
	root.style.setProperty('--halo-success', colors.success);
	root.style.setProperty('--halo-error', colors.error);
	// Premium UI Tokens
	root.style.setProperty('--halo-card-bg', colors.cardBg);
	root.style.setProperty('--halo-glass-border', colors.glassBorder);
	root.style.setProperty('--halo-shadow', colors.shadow);

	// Body background
	document.body.style.backgroundColor = colors.bg;
	document.body.style.color = colors.text;
}

/**
 * Load settings from storage (with timeout for test environments)
 */
export async function loadSettings(): Promise<HaloSettings> {
	const result = await safeStorageGet<{ [SETTINGS_STORAGE_KEY]?: Partial<HaloSettings> }>(
		[SETTINGS_STORAGE_KEY],
		{},
		{ area: 'sync' }
	);
	return { ...DEFAULT_SETTINGS, ...result[SETTINGS_STORAGE_KEY] };
}

/**
 * Save settings to storage
 */
export async function saveSettings(settings: Partial<HaloSettings>): Promise<HaloSettings> {
	const current = await loadSettings();
	const updated = { ...current, ...settings };
	await safeStorageSet({ [SETTINGS_STORAGE_KEY]: updated }, { area: 'sync' });
	return updated;
}
