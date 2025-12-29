// goal: Outline tool type definitions

export interface HeadingItem {
	id: string;
	level: number;
	text: string;
	element?: HTMLElement;
}

export interface OutlineState {
	headings: HeadingItem[];
	loading: boolean;
	error: string | null;
}

export const STORAGE_KEY = 'HALO_OUTLINE_SETTINGS';

export interface OutlineSettings {
	minLevel: number;
	maxLevel: number;
	showNumbers: boolean;
}

export const DEFAULT_SETTINGS: OutlineSettings = {
	minLevel: 1,
	maxLevel: 6,
	showNumbers: true,
};
