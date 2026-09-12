import type { UserScriptState } from './types';
import { conditionalLedgerWrite, readLedgerEntry } from '../../kernel/core/safe-storage';
import { parseUserScriptsStorageValue } from './storage-schema';

export const STORAGE_KEY = 'halo_userscripts';

// Get all scripts
export async function getUserScriptsState(): Promise<UserScriptState> {
	const parsed = parseUserScriptsStorageValue((await readLedgerEntry(STORAGE_KEY, { area: 'local' })).value);
	if (parsed.failed) throw new Error('Stored user scripts do not match the persistence contract');
	return { scripts: structuredClone(parsed.scripts), globalEnabled: parsed.globalEnabled, ...(parsed.toolbarConfig ? { toolbarConfig: structuredClone(parsed.toolbarConfig) } : {}) } as UserScriptState;
}

// Save state
export async function saveState(state: UserScriptState): Promise<void> {
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, { area: 'local', baseRevision: base.revision, value: state });
	if (outcome.kind !== 'committed') throw new Error('User script state was not committed; reload before retrying');
}
