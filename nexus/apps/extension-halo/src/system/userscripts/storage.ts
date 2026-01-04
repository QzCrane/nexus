import type { UserScriptState } from './types';

export const STORAGE_KEY = 'halo_userscripts';

import { safeStorageGet, safeStorageSet } from '../../kernel/core/safe-storage';

const DEFAULT_STATE: UserScriptState = {
	scripts: [],
	globalEnabled: true,
};

// Get all scripts
export async function getUserScriptsState(): Promise<UserScriptState> {
	const result = await safeStorageGet([STORAGE_KEY], { [STORAGE_KEY]: DEFAULT_STATE }, 'local');
	return result[STORAGE_KEY];
}

// Save state
export async function saveState(state: UserScriptState): Promise<void> {
	await safeStorageSet({ [STORAGE_KEY]: state }, 'local');
}
