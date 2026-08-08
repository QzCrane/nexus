// goal: tiny cross-context packaged-module activation contract
// inv: optional packaged modules default enabled; an explicit non-true stored value fails closed

export const MODULE_INSTALLATION_STORAGE_PREFIX = 'halo_module_enabled_v2:';

export function moduleInstallationStorageKey(id: string): string {
	return `${MODULE_INSTALLATION_STORAGE_PREFIX}${id}`;
}

export function isOptionalPackagedModuleStoredEnabled(
	storedValue: unknown,
	keyPresent: boolean,
): boolean {
	// Absence is the packaged/default-installed state. We currently write only a
	// false tombstone; explicit true is accepted so repair/migration tools can
	// restore enablement without requiring remove() to have happened first.
	if (!keyPresent) return true;
	return storedValue === true;
}

export async function readOptionalPackagedModuleEnabled(id: string): Promise<boolean> {
	const key = moduleInstallationStorageKey(id);
	const result = await chrome.storage.local.get(key);
	return isOptionalPackagedModuleStoredEnabled(result[key], Object.hasOwn(result, key));
}

export function readOptionalPackagedModuleChangeEnabled(
	change: chrome.storage.StorageChange,
): boolean {
	return isOptionalPackagedModuleStoredEnabled(
		change.newValue,
		change.newValue !== undefined,
	);
}
