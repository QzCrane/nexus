export interface PermissionDef {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: 'basic' | 'advanced' | 'privacy';
}

export interface PermissionState {
	id: string;
	granted: boolean;
}

// All available optional permissions with descriptions
export const OPTIONAL_PERMISSIONS: PermissionDef[] = [
	{
		id: 'pageCapture',
		name: 'Page Capture',
		description: 'Save complete web pages as MHTML files',
		icon: '📥',
		category: 'basic',
	},
	{
		id: 'webNavigation',
		name: 'Web Navigation',
		description: 'Detect page navigation for UserScripts injection',
		icon: '🧭',
		category: 'basic',
	},
	{
		id: 'clipboardRead',
		name: 'Clipboard Read',
		description: 'Read text from your clipboard',
		icon: '📋',
		category: 'privacy',
	},
	{
		id: 'clipboardWrite',
		name: 'Clipboard Write',
		description: 'Copy text to your clipboard',
		icon: '📝',
		category: 'basic',
	},
	{
		id: 'downloads',
		name: 'Downloads',
		description: 'Manage file downloads',
		icon: '⬇️',
		category: 'basic',
	},
	{
		id: 'history',
		name: 'History',
		description: 'Access browsing history',
		icon: '🕐',
		category: 'privacy',
	},
	{
		id: 'bookmarks',
		name: 'Bookmarks',
		description: 'Access and manage bookmarks',
		icon: '⭐',
		category: 'privacy',
	},
	{
		id: 'topSites',
		name: 'Top Sites',
		description: 'Access most visited sites data',
		icon: '📊',
		category: 'privacy',
	},
	{
		id: 'notifications',
		name: 'Notifications',
		description: 'Show system desktop notifications',
		icon: '🔔',
		category: 'basic',
	},
	{
		id: 'tabGroups',
		name: 'Tab Groups',
		description: 'Access and modify tab groups',
		icon: '📑',
		category: 'basic',
	},
	{
		id: 'userScripts',
		name: 'User Scripts',
		description: 'Execute custom scripts (chrome.userScripts)',
		icon: '📜',
		category: 'advanced',
	},
	{
		id: 'management',
		name: 'Extension Management',
		description: 'Manage installed extensions',
		icon: '🔌',
		category: 'advanced',
	},
];

// All hosts permission (for UserScripts injection to any site)
export const HOST_PERMISSIONS: PermissionDef = {
	id: '*://*/*',
	name: 'All Websites',
	description: 'Allow script injection on any website (required for UserScripts)',
	icon: '🌐',
	category: 'advanced',
};
