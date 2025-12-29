// goal: JSON Formatter tool type definitions

export interface FormatOptions {
	indent: 2 | 4;
	sortKeys: boolean;
}

export interface JSONState {
	input: string;
	output: string;
	error: string | null;
	options: FormatOptions;
}

export const DEFAULT_OPTIONS: FormatOptions = {
	indent: 2,
	sortKeys: false,
};

export const STORAGE_KEY = 'HALO_JSON_OPTIONS';
