// goal: Global settings type definitions

export type ThemeMode = 'dark' | 'light' | 'system';
// IconSize is now a number (px)
export type IconSize = number;

export interface HaloSettings {
	theme: ThemeMode;
	accentColor: string;
	spacing: number; // Replaces compactMode (px)
	showToolLabels: boolean;
	showSystemTools: boolean; // Toggle for system plugins category
	iconSize: number; // px
	defaultTool: string | null;
	pinnedTools: string[];
	toolOrder: Record<string, string[]>;
	categoryOrder: string[];
	headerLayout: string[]; // IDs of tools to show in header
}

export const DEFAULT_SETTINGS: HaloSettings = {
	theme: 'system',
	accentColor: '#7c3aed',
	spacing: 12,
	showToolLabels: true,
	showSystemTools: true,
	iconSize: 24,
	defaultTool: null,
	pinnedTools: [],
	toolOrder: {},
	categoryOrder: ['active', 'general', 'dev', 'efficiency', 'visual', 'ai', 'security', 'media', 'browser'],
	headerLayout: ['module-store', 'extension-manager', 'permissions', 'userscripts', 'settings'], // IDs of tools to show in header
};

export const ACCENT_COLORS = [
	{ name: 'Purple', value: '#7c3aed' },
	{ name: 'Blue', value: '#3b82f6' },
	{ name: 'Cyan', value: '#06b6d4' },
	{ name: 'Green', value: '#22c55e' },
	{ name: 'Orange', value: '#f97316' },
	{ name: 'Pink', value: '#ec4899' },
	{ name: 'Red', value: '#ef4444' },
];

export const SETTINGS_STORAGE_KEY = 'HALO_SETTINGS';
