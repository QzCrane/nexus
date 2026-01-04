// goal: Extension manager core logic
// eff: Wraps chrome.management API with error handling

import type { ExtensionInfo, ExtensionGroup } from './types';
import { STORAGE_KEY } from './types';

const LOG_TAG = '[HALO:ExtMgr]';

/**
 * Fetch all installed extensions
 */
export async function getAllExtensions(): Promise<ExtensionInfo[]> {
	try {
		const all = await chrome.management.getAll();
		// Exclude self and apps (only extensions)
		const selfId = chrome.runtime.id;
		return all
			.filter(ext => ext.id !== selfId && ext.type === 'extension')
			.map(ext => ({
				id: ext.id,
				name: ext.name,
				shortName: ext.shortName,
				description: ext.description,
				version: ext.version,
				enabled: ext.enabled,
				type: ext.type,
				icons: ext.icons,
				permissions: ext.permissions || [],
				hostPermissions: ext.hostPermissions || [],
				optionsUrl: ext.optionsUrl,
				homepageUrl: ext.homepageUrl,
				mayDisable: ext.mayDisable,
				installType: ext.installType,
			}));
	} catch (e) {
		console.error(LOG_TAG, 'Failed to get extensions:', e);
		return [];
	}
}

/**
 * Enable an extension
 */
export async function enableExtension(id: string): Promise<boolean> {
	try {
		await chrome.management.setEnabled(id, true);
		console.log(LOG_TAG, 'Enabled:', id);
		return true;
	} catch (e) {
		console.error(LOG_TAG, 'Failed to enable:', id, e);
		return false;
	}
}

/**
 * Disable an extension
 */
export async function disableExtension(id: string): Promise<boolean> {
	try {
		await chrome.management.setEnabled(id, false);
		console.log(LOG_TAG, 'Disabled:', id);
		return true;
	} catch (e) {
		console.error(LOG_TAG, 'Failed to disable:', id, e);
		return false;
	}
}

/**
 * Toggle extension enabled state
 */
export async function toggleExtension(ext: ExtensionInfo): Promise<boolean> {
	return ext.enabled ? disableExtension(ext.id) : enableExtension(ext.id);
}

/**
 * Open extension options page
 */
export function openOptionsPage(ext: ExtensionInfo): void {
	if (ext.optionsUrl) {
		chrome.tabs.create({ url: ext.optionsUrl });
	}
}

/**
 * Open chrome://extensions page for this extension
 */
export function openDetailsPage(id: string): void {
	chrome.tabs.create({ url: `chrome://extensions/?id=${id}` });
}

/**
 * Launch extension popup (if available)
 * Note: chrome.management doesn't provide direct popup launching.
 * Falls back to opening options page or details page.
 */
export async function launchExtension(ext: ExtensionInfo): Promise<void> {
	// Priority: popup (not available via API) > options > details
	if (ext.optionsUrl) {
		chrome.tabs.create({ url: ext.optionsUrl });
	} else {
		openDetailsPage(ext.id);
	}
}

/**
 * Uninstall an extension (prompts user)
 */
export async function uninstallExtension(id: string): Promise<boolean> {
	try {
		await chrome.management.uninstall(id, { showConfirmDialog: true });
		return true;
	} catch {
		return false; // User cancelled or error
	}
}

/**
 * Load saved groups from storage
 */
export async function loadGroups(): Promise<Record<ExtensionGroup, string[]>> {
	try {
		const result = await chrome.storage.local.get(STORAGE_KEY);
		return result[STORAGE_KEY] || { dev: [], work: [], entertainment: [], other: [] };
	} catch {
		return { dev: [], work: [], entertainment: [], other: [] };
	}
}

/**
 * Save groups to storage
 */
export async function saveGroups(groups: Record<ExtensionGroup, string[]>): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: groups });
}

/**
 * Assign extension to a group (pass empty string to remove from all groups)
 */
export async function assignToGroup(
	extId: string,
	group: ExtensionGroup | '',
	currentGroups: Record<ExtensionGroup, string[]>
): Promise<Record<ExtensionGroup, string[]>> {
	const newGroups = { ...currentGroups };
	// Remove from all groups first
	for (const g of Object.keys(newGroups) as ExtensionGroup[]) {
		newGroups[g] = newGroups[g].filter(id => id !== extId);
	}
	// Add to new group (only if group is specified)
	if (group && group in newGroups) {
		newGroups[group] = [...newGroups[group], extId];
	}
	await saveGroups(newGroups);
	return newGroups;
}

/**
 * Get icon URL for extension
 */
export function getExtensionIcon(ext: ExtensionInfo, size = 32): string {
	if (!ext.icons?.length) return '';
	// Find closest size
	const sorted = [...ext.icons].sort((a, b) => Math.abs(a.size - size) - Math.abs(b.size - size));
	return sorted[0]?.url || '';
}
