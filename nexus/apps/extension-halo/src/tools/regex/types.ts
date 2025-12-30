// goal: Regex tester type definitions

export interface RegexMatch {
	index: number;
	text: string;
	groups: Record<string, string> | null;
	line: number;
	column: number;
}

export interface RegexFlags {
	global: boolean;
	ignoreCase: boolean;
	multiline: boolean;
	dotAll: boolean;
	unicode: boolean;
}

export interface RegexPreset {
	name: string;
	pattern: string;
	flags: string;
}

export const DEFAULT_FLAGS: RegexFlags = {
	global: true,
	ignoreCase: false,
	multiline: false,
	dotAll: false,
	unicode: false,
};

export const PRESETS: RegexPreset[] = [
	{ name: 'Email', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', flags: 'gi' },
	{ name: 'URL', pattern: 'https?://[^\\s]+', flags: 'gi' },
	{ name: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g' },
	{ name: 'Phone', pattern: '\\+?\\d[\\d\\s-]{7,}\\d', flags: 'g' },
	{ name: 'Date', pattern: '\\d{4}[-/]\\d{2}[-/]\\d{2}', flags: 'g' },
	{ name: 'Hex Color', pattern: '#[0-9A-Fa-f]{3,8}\\b', flags: 'gi' },
];

export const STORAGE_KEY = 'HALO_REGEX_HISTORY';
