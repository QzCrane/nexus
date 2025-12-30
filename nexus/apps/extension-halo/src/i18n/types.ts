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
	// Tool-specific UI strings
	qrcodePanel: {
		placeholder: string;
		generate: string;
		generating: string;
		copy: string;
		save: string;
		copied: string;
		downloaded: string;
		failed: string;
		recent: string;
		scan: string;
		scanFromImage: string;
		scanFromClipboard: string;
		scanning: string;
		scanSuccess: string;
		scanFailed: string;
		detectedContent: string;
		openLink: string;
		copyText: string;
	};
	colorPanel: {
		pickFromPage: string;
		history: string;
		noHistory: string;
		copied: string;
	};
	rulerPanel: {
		start: string;
		cancel: string;
		measuring: string;
		result: string;
		width: string;
		height: string;
		diagonal: string;
		ready: string;
	};
	jsonPanel: {
		placeholder: string;
		format: string;
		minify: string;
		sortKeys: string;
		copy: string;
		clear: string;
		invalidJson: string;
		formatted: string;
		minified: string;
		copied: string;
	};
	outlinePanel: {
		noHeadings: string;
		exportMd: string;
		refresh: string;
		jumpTo: string;
		exported: string;
	};
	clipboardPanel: {
		searchPlaceholder: string;
		clearUnpinned: string;
		empty: string;
		noMatch: string;
		pin: string;
		unpin: string;
		delete: string;
		copy: string;
		copied: string;
		unknownSource: string;
		pinned: string;
		confirmClear: string;
	};
	smoothScroll: {
		enable: string;
		enableDesc: string;
		behavior: string;
		stepSize: string;
		stepSizeDesc: string;
		animationTime: string;
		animationTimeDesc: string;
		accelerationMax: string;
		accelerationDelta: string;
		pulseScale: string;
		arrowKeyStep: string;
		easing: string;
		inputSources: string;
		mouseWheel: string;
		keyboard: string;
		touchpad: string;
		features: string;
		middleClickAutoScroll: string;
		fixedBackground: string;
		profiles: string;
		loadProfile: string;
		configMgmt: string;
		export: string;
		import: string;
		reset: string;
		saveCustom: string;
	};
	regex: {
		patternPlaceholder: string;
		testString: string;
		testPlaceholder: string;
		replaceMode: string;
		replacePlaceholder: string;
		matches: string;
	};
	base64: {
		encode: string;
		decode: string;
		urlSafe: string;
		input: string;
		output: string;
		inputPlaceholder: string;
		decodePlaceholder: string;
		outputPlaceholder: string;
		dropFile: string;
		swap: string;
	};
	hash: {
		input: string;
		placeholder: string;
		output: string;
	};
	uuid: {
		count: string;
		generate: string;
		placeholder: string;
	};
	timestamp: {
		input: string;
		output: string;
		current: string;
	};
	url: {
		encode: string;
		decode: string;
		parse: string;
		input: string;
		output: string;
	};
}

export type TranslationPath =
	| `common.${keyof TranslationKeys['common']}`
	| `categories.${ToolCategory}`
	| `tools.${string}.name`
	| `tools.${string}.desc`
	| `settings.${keyof TranslationKeys['settings']}`
	| `toolManager.${keyof TranslationKeys['toolManager']}`
	| `footer.${keyof TranslationKeys['footer']}`
	| `regex.${keyof TranslationKeys['regex']}`
	| `base64.${keyof TranslationKeys['base64']}`
	| `hash.${keyof TranslationKeys['hash']}`
	| `uuid.${keyof TranslationKeys['uuid']}`
	| `timestamp.${keyof TranslationKeys['timestamp']}`
	| `url.${keyof TranslationKeys['url']}`;
