// goal: Detailed translation interface definitions
// eff: Split from main types.ts to reduce file size

import type { ToolCategory } from './types';

export interface BaseTranslations {
	common: {
		search: string;
		settings: string;
		tools: string;
		favorites: string;
		all: string;
		enabled: string;
		disabled: string;
		comingSoon: string;
		selectTool: string;
		noResults: string;
		loading: string;
		save: string;
		cancel: string;
		reset: string;
		language: string;
	};
	categories: Record<ToolCategory, string>;
	footer: {
		zeroTracking: string;
		localOnly: string;
	};
	layout: {
		mode: string;
		launcher: string;
		classic: string;
		showLabels: string;
		hideLabels: string;
		popOut: string;
	};
}

export interface SettingsTranslations {
	settings: {
		title: string;
		appearance: string;
		theme: string;
		themeDesc: string;
		dark: string;
		light: string;
		system: string;
		accentColor: string;
		accentColorDesc: string;
		interface: string;
		compactMode: string;
		compactModeDesc: string;
		showLabels: string;
		showLabelsDesc: string;
		animations: string;
		animationsDesc: string;
		toolManagement: string;
		manageTools: string;
		manageToolsDesc: string;
		languageSetting: string;
		languageSettingDesc: string;
		actions: string;
		resetAll: string;
		version: string;
	};
	toolManager: {
		title: string;
		searchPlaceholder: string;
		enableAll: string;
		disableAll: string;
		sortByName: string;
		sortByUsage: string;
		pinned: string;
		unpinned: string;
		enable: string;
		disable: string;
		pin: string;
		unpin: string;
	};
}

export interface ModuleTranslations {
	tools?: Record<string, { name: string; desc: string }>;
}
