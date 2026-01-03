import type { UserScriptState } from './types';

export const STORAGE_KEY = 'halo_userscripts';

// Default state
const DEFAULT_STATE: UserScriptState = {
	scripts: [],
	globalEnabled: true,
};

// Get all scripts
export async function getUserScriptsState(): Promise<UserScriptState> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] || DEFAULT_STATE;
}

// Save state
export async function saveState(state: UserScriptState): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
