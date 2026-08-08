// goal: one cross-context authority for packaged-module enablement
// inv: built-in modules are always enabled; optional modules are enabled unless an explicit false tombstone exists

import type { ModuleMeta } from '../core/tool-registry-types';
import { ALL_MODULES, OPTIONAL_MODULES } from '../registry/module-registry';

const STORAGE_PREFIX = 'halo_module_enabled_v2:';
const OPTIONAL_BY_ID = new Map(OPTIONAL_MODULES.map((module) => [module.id, module]));
const MODULE_BY_ID = new Map(ALL_MODULES.map((module) => [module.id, module]));

export function moduleInstallationStorageKey(id: string): string {
	return `${STORAGE_PREFIX}${id}`;
}

export function moduleIdFromInstallationStorageKey(key: string): string | null {
	if (!key.startsWith(STORAGE_PREFIX)) return null;
	const id = key.slice(STORAGE_PREFIX.length);
	return OPTIONAL_BY_ID.has(id) ? id : null;
}

export function isPackagedModuleMetaEnabled(
	module: Pick<ModuleMeta, 'id' | 'builtIn'>,
	storedValue: unknown,
	keyPresent: boolean,
): boolean {
	if (module.builtIn) return true;
	// Missing state means the code shipped with this extension is installed by
	// default. Only an explicit boolean false tombstone represents uninstall.
	// Corrupt explicit state fails closed instead of activating a runtime.
	if (!keyPresent) return true;
	return storedValue === true;
}

export async function readPackagedModuleEnabled(id: string): Promise<boolean> {
	const module = MODULE_BY_ID.get(id);
	if (!module) return false;
	if (module.builtIn) return true;
	const key = moduleInstallationStorageKey(id);
	const result = await chrome.storage.local.get(key);
	return isPackagedModuleMetaEnabled(module, result[key], Object.hasOwn(result, key));
}

export async function readDisabledPackagedModuleIds(): Promise<Set<string>> {
	const keys = OPTIONAL_MODULES.map((module) => moduleInstallationStorageKey(module.id));
	const result = await chrome.storage.local.get(keys);
	const disabled = new Set<string>();
	for (const module of OPTIONAL_MODULES) {
		const key = moduleInstallationStorageKey(module.id);
		if (!isPackagedModuleMetaEnabled(module, result[key], Object.hasOwn(result, key))) {
			disabled.add(module.id);
		}
	}
	return disabled;
}

export async function writePackagedModuleEnabled(id: string, enabled: boolean): Promise<void> {
	const module = OPTIONAL_BY_ID.get(id);
	if (!module) {
		if (MODULE_BY_ID.get(id)?.builtIn) {
			if (!enabled) throw new Error(`Cannot disable built-in module: ${id}`);
			return;
		}
		throw new Error(`Unknown packaged module: ${id}`);
	}
	const key = moduleInstallationStorageKey(id);
	if (enabled) await chrome.storage.local.remove(key);
	else await chrome.storage.local.set({ [key]: false });
}

export function isModuleInstallationChange(
	changes: Record<string, chrome.storage.StorageChange>,
): boolean {
	return Object.keys(changes).some((key) => moduleIdFromInstallationStorageKey(key) !== null);
}

export const moduleInstallationStoreTestApi = {
	STORAGE_PREFIX,
};
