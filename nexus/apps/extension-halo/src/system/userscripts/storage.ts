import type { UserScriptState } from './types';

export const STORAGE_KEY = 'halo_userscripts';

// rule: factory rather than a shared constant. The previous shared DEFAULT_STATE
// was returned by reference from getUserScriptsState() whenever storage was empty,
// so the first caller to mutate its returned state (e.g., `state.scripts.push(...)`)
// corrupted every subsequent empty-storage read across the extension — the
// "default" silently became whatever the last mutator left behind.
export function createDefaultUserScriptState(): UserScriptState {
	return { scripts: [], globalEnabled: true };
}

// Get all scripts
export async function getUserScriptsState(): Promise<UserScriptState> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	if (result[STORAGE_KEY]) {
		return result[STORAGE_KEY] as UserScriptState;
	}
	return createDefaultUserScriptState();
}

// Save state
export async function saveState(state: UserScriptState): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
