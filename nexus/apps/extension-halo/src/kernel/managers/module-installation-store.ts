// goal: catalog adapter for packaged-module enablement
// inv: runtime contexts import only the tiny core contract, never the full registry

import type { ModuleMeta } from '../core/tool-registry-types';
import {
	MODULE_INSTALLATION_STORAGE_PREFIX,
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../core/module-installation-runtime';
import { ALL_MODULES, OPTIONAL_MODULES } from '../registry/module-registry';
import { conditionalLedgerRemove, conditionalLedgerWrite, readLedgerEntry } from '../core/safe-storage';

const OPTIONAL_BY_ID = new Map(OPTIONAL_MODULES.map((module) => [module.id, module]));
const MODULE_BY_ID = new Map(ALL_MODULES.map((module) => [module.id, module]));

export function moduleIdFromInstallationStorageKey(key: string): string | null {
	if (!key.startsWith(MODULE_INSTALLATION_STORAGE_PREFIX)) return null;
	const id = key.slice(MODULE_INSTALLATION_STORAGE_PREFIX.length);
	return OPTIONAL_BY_ID.has(id) ? id : null;
}

export function isPackagedModuleMetaEnabled(
	module: Pick<ModuleMeta, 'builtIn'>,
	storedValue: unknown,
	keyPresent: boolean,
): boolean {
	return module.builtIn
		? true
		: isOptionalPackagedModuleStoredEnabled(storedValue, keyPresent);
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
	const base = await readLedgerEntry(key, { area: 'local' });
	const outcome = enabled
		? await conditionalLedgerRemove(key, { area: 'local', baseRevision: base.revision })
		: await conditionalLedgerWrite(key, { area: 'local', baseRevision: base.revision, value: false });
	if (outcome.kind !== 'committed') throw new Error(`Module installation state was not committed: ${id}`);
}
