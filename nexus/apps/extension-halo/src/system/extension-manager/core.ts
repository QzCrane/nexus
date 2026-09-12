// goal: Extension manager core logic
// eff: Wraps chrome.management API with error handling

import type { ExtensionInfo, ExtensionGroup } from './types';
import { STORAGE_KEY } from './types';
import { conditionalLedgerWrite, readLedgerEntry } from '../../kernel/core/safe-storage';
import { reportStorageHealth } from '../../kernel/core/storage-health';

const LOG_TAG = '[HALO:ExtMgr]';
const storageHealthOwner = Symbol('extension-groups');
const EMPTY_GROUPS: Record<ExtensionGroup, string[]> = { dev: [], work: [], entertainment: [], other: [] };

function parseGroups(value: unknown): Record<ExtensionGroup, string[]> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return structuredClone(EMPTY_GROUPS);
	const record = value as Record<string, unknown>;
	const groups = structuredClone(EMPTY_GROUPS);
	for (const group of Object.keys(groups) as ExtensionGroup[]) {
		const ids = record[group];
		if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return structuredClone(EMPTY_GROUPS);
		groups[group] = [...new Set(ids as string[])];
	}
	return groups;
}

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
		return parseGroups((await readLedgerEntry(STORAGE_KEY, { area: 'local' })).value);
	} catch {
		return structuredClone(EMPTY_GROUPS);
	}
}

/**
 * Save groups to storage
 */
export async function saveGroups(groups: Record<ExtensionGroup, string[]>): Promise<void> {
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, { area: 'local', baseRevision: base.revision, value: parseGroups(groups) });
	if (outcome.kind !== 'committed') { reportStorageHealth(storageHealthOwner, outcome.kind === 'unknown' ? 'write-unknown' : 'write-error'); throw new Error('Extension groups were not committed'); }
	reportStorageHealth(storageHealthOwner, null);
}

/**
 * Assign extension to a group, or remove from all groups if group is empty/undefined
 */
export async function assignToGroup(
	extId: string,
	group: ExtensionGroup | '' | undefined,
	currentGroups: Record<ExtensionGroup, string[]>
): Promise<Record<ExtensionGroup, string[]>> {
	const apply = (value: unknown): Record<ExtensionGroup, string[]> => {
		const next = parseGroups(value);
		for (const key of Object.keys(next) as ExtensionGroup[]) next[key] = next[key].filter((id) => id !== extId);
		if (group && group in next) next[group] = [...next[group], extId];
		return next;
	};
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
		area: 'local', baseRevision: base.revision, value: apply(base.value ?? currentGroups), remerge: apply,
	});
	if (outcome.kind !== 'committed') { reportStorageHealth(storageHealthOwner, outcome.kind === 'unknown' ? 'write-unknown' : 'write-error'); throw new Error('Extension group assignment was not committed'); }
	reportStorageHealth(storageHealthOwner, null);
	return parseGroups(outcome.value);
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
