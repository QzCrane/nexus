// goal: Global settings type definitions

export type ThemeMode = 'dark' | 'light' | 'system';

export interface HaloSettings {
	theme: ThemeMode;
	accentColor: string;
	compactMode: boolean;
	showToolLabels: boolean;
	defaultTool: string | null;
	animationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: HaloSettings = {
	theme: 'dark',
	accentColor: '#7c3aed',
	compactMode: false,
	showToolLabels: true,
	defaultTool: null,
	animationsEnabled: true,
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
