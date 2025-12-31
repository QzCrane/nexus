// goal: Permission manager core logic

import type { PermissionDef, PermissionState } from './types';

// All available optional permissions with descriptions
export const OPTIONAL_PERMISSIONS: PermissionDef[] = [
	{
		id: 'pageCapture',
		name: 'Page Capture',
		description: 'Save complete web pages as MHTML files',
		icon: '📥',
		category: 'basic',
		requiredBy: ['archive'],
	},
	{
		id: 'webNavigation',
		name: 'Web Navigation',
		description: 'Detect page navigation for UserScripts injection',
		icon: '🧭',
		category: 'basic',
		requiredBy: ['userscripts'],
	},
	{
		id: 'clipboardRead',
		name: 'Clipboard Read',
		description: 'Read text from your clipboard',
		icon: '📋',
		category: 'privacy',
		requiredBy: ['clipboard'],
	},
	{
		id: 'clipboardWrite',
		name: 'Clipboard Write',
		description: 'Copy text to your clipboard',
		icon: '📝',
		category: 'basic',
		requiredBy: ['clipboard', 'qrcode', 'color-picker'],
	},
	{
		id: 'downloads',
		name: 'Downloads',
		description: 'Manage file downloads',
		icon: '⬇️',
		category: 'basic',
		requiredBy: ['pdf', 'archive'],
	},
	{
		id: 'history',
		name: 'History',
		description: 'Access browsing history',
		icon: '🕐',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'bookmarks',
		name: 'Bookmarks',
		description: 'Access and manage bookmarks',
		icon: '⭐',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'topSites',
		name: 'Top Sites',
		description: 'Access most visited sites data',
		icon: '📊',
		category: 'privacy',
		requiredBy: [],
	},
	{
		id: 'notifications',
		name: 'Notifications',
		description: 'Show desktop notifications',
		icon: '🔔',
		category: 'basic',
		requiredBy: [],
	},
];

// All hosts permission (for UserScripts injection to any site)
export const HOST_PERMISSIONS: PermissionDef = {
	id: '*://*/*',
	name: 'All Websites',
	description: 'Allow script injection on any website (required for UserScripts)',
	icon: '🌐',
	category: 'advanced',
	requiredBy: ['userscripts'],
};

// Check if a permission is granted
export async function checkPermission(permission: string): Promise<boolean> {
	try {
		return await chrome.permissions.contains({ permissions: [permission] });
	} catch {
		return false;
	}
}

// Check if a host permission is granted
export async function checkHostPermission(origin: string): Promise<boolean> {
	try {
		return await chrome.permissions.contains({ origins: [origin] });
	} catch {
		return false;
	}
}

// Get all permission states
export async function getAllPermissionStates(): Promise<PermissionState[]> {
	const results: PermissionState[] = [];

	for (const perm of OPTIONAL_PERMISSIONS) {
		const granted = await checkPermission(perm.id);
		results.push({ id: perm.id, granted });
	}

	// Check host permission
	const hostGranted = await checkHostPermission(HOST_PERMISSIONS.id);
	results.push({ id: HOST_PERMISSIONS.id, granted: hostGranted });

	return results;
}

// Request a permission
export async function requestPermission(permission: string): Promise<boolean> {
	try {
		return await chrome.permissions.request({ permissions: [permission] });
	} catch (e) {
		console.error('[HALO:Permissions] Request failed:', e);
		return false;
	}
}

// Request host permission
export async function requestHostPermission(origin: string): Promise<boolean> {
	try {
		return await chrome.permissions.request({ origins: [origin] });
	} catch (e) {
		console.error('[HALO:Permissions] Host request failed:', e);
		return false;
	}
}

// Revoke a permission
export async function revokePermission(permission: string): Promise<boolean> {
	try {
		return await chrome.permissions.remove({ permissions: [permission] });
	} catch (e) {
		console.error('[HALO:Permissions] Revoke failed:', e);
		return false;
	}
}

// Revoke host permission
export async function revokeHostPermission(origin: string): Promise<boolean> {
	try {
		return await chrome.permissions.remove({ origins: [origin] });
	} catch (e) {
		console.error('[HALO:Permissions] Host revoke failed:', e);
		return false;
	}
}

// Get permissions required for a specific feature
export function getRequiredPermissions(featureId: string): PermissionDef[] {
	return OPTIONAL_PERMISSIONS.filter((p) => p.requiredBy.includes(featureId));
}
