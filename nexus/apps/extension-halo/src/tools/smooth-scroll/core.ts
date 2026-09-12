// goal: Smooth Scroll core logic and storage

import type { ScrollSettings } from './types';
import { normalizeScrollSettings, STORAGE_KEY } from './types';
import { CUSTOM_PROFILE_KEY } from './types';
import { conditionalLedgerWrite, readLedgerEntry } from '../../kernel/core/safe-storage';

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<ScrollSettings> {
	return normalizeScrollSettings((await readLedgerEntry(STORAGE_KEY, { area: 'sync' })).value);
}

export async function loadCustomProfile(): Promise<ScrollSettings | null> {
	const value = (await readLedgerEntry(CUSTOM_PROFILE_KEY, { area: 'sync' })).value;
	return value === undefined ? null : normalizeScrollSettings(value);
}

export async function saveCustomProfile(settings: ScrollSettings): Promise<ScrollSettings> {
	const base = await readLedgerEntry(CUSTOM_PROFILE_KEY, { area: 'sync' });
	const value = normalizeScrollSettings(settings);
	const outcome = await conditionalLedgerWrite(CUSTOM_PROFILE_KEY, {
		area: 'sync', baseRevision: base.revision, value, remerge: () => value,
	});
	if (outcome.kind !== 'committed') throw new Error('Custom Smooth Scroll profile was not committed');
	return normalizeScrollSettings(outcome.value);
}

/**
 * Save settings to storage
 */
export async function saveSettings(
	partial: Partial<ScrollSettings>
): Promise<ScrollSettings> {
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'sync' });
	const current = normalizeScrollSettings(base.value);
	const updated = normalizeScrollSettings({ ...current, ...partial });
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
		area: 'sync', baseRevision: base.revision, value: updated,
		remerge: (stored) => normalizeScrollSettings({ ...normalizeScrollSettings(stored), ...partial }),
	});
	if (outcome.kind !== 'committed') throw new Error('Smooth Scroll settings were not committed');
	return normalizeScrollSettings(outcome.value);
}
