// goal: i18n type definitions
// eff: Type-safe translation keys + locale structure

export type Locale = 'en' | 'zh';

// Tool categories for grouping
export type ToolCategory = 'general' | 'dev' | 'efficiency' | 'visual' | 'ai';

// Translation keys structure
export interface TranslationKeys {
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
	tools: Record<string, { name: string; desc: string }>;
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
	footer: {
		zeroTracking: string;
		localOnly: string;
	};
}

export type TranslationPath =
	| `common.${keyof TranslationKeys['common']}`
	| `categories.${ToolCategory}`
	| `tools.${string}.name`
	| `tools.${string}.desc`
	| `settings.${keyof TranslationKeys['settings']}`
	| `toolManager.${keyof TranslationKeys['toolManager']}`
	| `footer.${keyof TranslationKeys['footer']}`;
