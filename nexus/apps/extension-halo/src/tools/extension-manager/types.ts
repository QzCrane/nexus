// goal: Extension manager types
// eff: Defines extension info and group structures

export type ExtensionGroup = 'dev' | 'work' | 'entertainment' | 'other';

export interface ExtensionInfo {
	id: string;
	name: string;
	shortName?: string;
	description: string;
	version: string;
	enabled: boolean;
	type: chrome.management.ExtensionType;
	icons?: chrome.management.IconInfo[];
	permissions: string[];
	hostPermissions: string[];
	optionsUrl?: string;
	homepageUrl?: string;
	mayDisable: boolean;
	installType: chrome.management.ExtensionInstallType;
	// Custom fields
	group?: ExtensionGroup;
}

export interface GroupConfig {
	id: ExtensionGroup;
	label: string;
	icon: string;
	extensionIds: string[];
}

export interface ExtManagerState {
	extensions: ExtensionInfo[];
	groups: Record<ExtensionGroup, string[]>;
	filter: 'all' | 'enabled' | 'disabled' | ExtensionGroup;
	searchQuery: string;
	loading: boolean;
}

export const DEFAULT_GROUPS: Record<ExtensionGroup, GroupConfig> = {
	dev: { id: 'dev', label: 'extMgr.dev', icon: '🛠️', extensionIds: [] },
	work: { id: 'work', label: 'extMgr.work', icon: '💼', extensionIds: [] },
	entertainment: { id: 'entertainment', label: 'extMgr.entertainment', icon: '🎮', extensionIds: [] },
	other: { id: 'other', label: 'extMgr.other', icon: '📦', extensionIds: [] },
};

export const STORAGE_KEY = 'halo_extension_manager_groups';
