
// goal: Define types for Tab Manager
// scope: module

export interface TabItem {
	id: number;
	windowId: number;
	title: string;
	url: string;
	favIconUrl?: string;
	active: boolean;
	pinned: boolean;
	audible?: boolean;
	mutedInfo?: chrome.tabs.MutedInfo;
}

export type TabFilter = 'all' | 'audible' | 'pinned';

export interface TabState {
	tabs: TabItem[];
	searchQuery: string;
	filter: TabFilter;
	loading: boolean;
}
