// goal: English translations
// eff: Default locale

import type { TranslationKeys } from '../types';

export const en: TranslationKeys = {
	common: {
		search: 'Search tools...',
		settings: 'Settings',
		tools: 'Tools',
		favorites: 'Favorites',
		all: 'All',
		enabled: 'Enabled',
		disabled: 'Disabled',
		comingSoon: 'Coming Soon',
		selectTool: 'Select a tool to begin',
		noResults: 'No tools found',
		loading: 'Loading...',
		save: 'Save',
		cancel: 'Cancel',
		reset: 'Reset',
		language: 'Language',
	},
	categories: {
		general: 'General',
		dev: 'Developer',
		efficiency: 'Efficiency',
		visual: 'Visual',
		ai: 'AI & Smart',
	},
	tools: {
		qrcode: {
			name: 'QR Code',
			desc: 'Generate QR codes with history & right-click integration',
		},
		'color-picker': {
			name: 'Color Picker',
			desc: 'Pick colors in HEX/RGB/HSL with history',
		},
		ruler: {
			name: 'Ruler',
			desc: 'Measure page elements in px/rem',
		},
		'json-formatter': {
			name: 'JSON',
			desc: 'Format, compress & sort JSON keys',
		},
		outline: {
			name: 'Outline',
			desc: 'Page headings with jump & markdown export',
		},
		clipboard: {
			name: 'Clipboard',
			desc: 'Smart clipboard with cross-page references',
		},
		pdf: {
			name: 'PDF Tools',
			desc: 'Merge, split & compress PDFs locally',
		},
		archive: {
			name: 'Archive',
			desc: 'Save complete web pages offline',
		},
		screenshot: {
			name: 'Screenshot',
			desc: 'Capture & annotate screenshots',
		},
		regex: {
			name: 'Regex',
			desc: 'Test regular expressions with live preview',
		},
		'base64': {
			name: 'Base64',
			desc: 'Encode & decode Base64 strings',
		},
		timer: {
			name: 'Timer',
			desc: 'Pomodoro timer & stopwatch',
		},
		notes: {
			name: 'Quick Notes',
			desc: 'Take quick notes anywhere',
		},
		settings: {
			name: 'Settings',
			desc: 'Customize HALO appearance & behavior',
		},
	},
	settings: {
		title: 'Settings',
		appearance: 'Appearance',
		theme: 'Theme',
		themeDesc: 'Choose your preferred color scheme',
		dark: 'Dark',
		light: 'Light',
		system: 'System',
		accentColor: 'Accent Color',
		accentColorDesc: 'Customize the primary color',
		interface: 'Interface',
		compactMode: 'Compact Mode',
		compactModeDesc: 'Reduce spacing for smaller screens',
		showLabels: 'Show Tool Labels',
		showLabelsDesc: 'Display text under tool icons',
		animations: 'Animations',
		animationsDesc: 'Enable smooth transitions',
		toolManagement: 'Tool Management',
		manageTools: 'Manage Tools',
		manageToolsDesc: 'Enable, disable, pin & reorder tools',
		languageSetting: 'Language',
		languageSettingDesc: 'Choose interface language',
		actions: 'Actions',
		resetAll: 'Reset All Settings',
		version: 'Made with 💜',
	},
	toolManager: {
		title: 'Tool Manager',
		searchPlaceholder: 'Search tools by name...',
		enableAll: 'Enable All',
		disableAll: 'Disable All',
		sortByName: 'Sort by Name',
		sortByUsage: 'Sort by Usage',
		pinned: 'Pinned',
		unpinned: 'Unpinned',
		enable: 'Enable',
		disable: 'Disable',
		pin: 'Pin',
		unpin: 'Unpin',
	},
	footer: {
		zeroTracking: 'Zero tracking',
		localOnly: 'Local only',
	},
};
