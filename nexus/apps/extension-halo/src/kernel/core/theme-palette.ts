// goal: one paint-surface palette shared by early initialization and hydrated theme
export const THEME_SURFACES = {
	dark: {
		bg: '#1a1a1a', bgSecondary: '#242424', bgTertiary: '#2a2a2a',
		text: '#f0f0f0', textSecondary: '#b0b0b0', textMuted: '#a0a0a0', border: '#333333',
	},
	light: {
		bg: '#ffffff', bgSecondary: '#f5f5f5', bgTertiary: '#eeeeee',
		text: '#1a1a1a', textSecondary: '#555555', textMuted: '#666666', border: '#e5e5e5',
	},
} as const;
