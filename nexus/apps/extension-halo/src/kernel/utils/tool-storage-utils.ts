// goal: Tool Storage Utilities
// eff: Extracted from use-tool-manager.ts

import type { ToolPrefs } from '../core/tool-registry-types';
import { TOOL_PREFS_KEY } from '../registry/tool-registry';
import { conditionalLedgerWrite, readLedgerEntry } from '../core/safe-storage';
import { reportStorageHealth } from '../core/storage-health';

const storageHealthOwner = Symbol('tool-preferences');
let saveTail = Promise.resolve();

// Load tool preferences from storage
export async function loadToolPrefs(): Promise<Record<string, ToolPrefs>> {
	try {
		return ((await readLedgerEntry<Record<string, ToolPrefs>>(TOOL_PREFS_KEY, { area: 'local' })).value) || {};
	} catch (error: unknown) {
		console.error('[HALO:ToolPrefs] Failed to load preferences', error);
		return {};
	}
}

// Save tool preferences
export async function saveToolPrefs(prefs: Record<string, ToolPrefs>): Promise<void> {
	const snapshot = structuredClone(prefs);
	const operation = saveTail.catch(() => undefined).then(async () => {
		const base = await readLedgerEntry(TOOL_PREFS_KEY, { area: 'local' });
		const outcome = await conditionalLedgerWrite(TOOL_PREFS_KEY, { area: 'local', baseRevision: base.revision, value: snapshot });
		if (outcome.kind === 'committed') { reportStorageHealth(storageHealthOwner, null); return; }
		reportStorageHealth(storageHealthOwner, outcome.kind === 'unknown' ? 'write-unknown' : 'write-error');
		throw new Error('Tool preferences were not committed');
	});
	saveTail = operation;
	await operation;
}
