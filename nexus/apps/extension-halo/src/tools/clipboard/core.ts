// goal: Clipboard tool core logic with converged cross-context history mutations
// note: every history mutation is a conditional read-modify-write. A concurrent
// writer no longer loses its entries: the mutation intent is re-applied to the
// freshly stored list, and pinned entries survive every admission path.

import { conditionalLedgerWrite, readLedgerEntry } from '@nexus/kernel';
import {
	type ClipboardItem,
	type ClipboardSettings,
	MAX_HISTORY,
	MAX_HISTORY_BYTES,
	parseClipboardHistory,
	parseClipboardSettings,
	clipboardHistoryBytes,
	SETTINGS_STORAGE_KEY,
	STORAGE_KEY,
} from './types';
import { reportStorageHealth } from '../../kernel/core/storage-health';

const settingsStorageHealthOwner = Symbol('clipboard-settings');

/**
 * Get clipboard settings
 */
export async function getClipboardSettings(): Promise<ClipboardSettings> {
	return parseClipboardSettings((await readLedgerEntry(SETTINGS_STORAGE_KEY, { area: 'local' })).value);
}

/**
 * Update clipboard settings
 */
export async function updateClipboardSettings(enabled: boolean): Promise<void> {
	const base = await readLedgerEntry(SETTINGS_STORAGE_KEY, { area: 'local' });
	const outcome = await conditionalLedgerWrite(SETTINGS_STORAGE_KEY, { area: 'local', baseRevision: base.revision, value: { enabled } });
	if (outcome.kind !== 'committed') { reportStorageHealth(settingsStorageHealthOwner, outcome.kind === 'unknown' ? 'write-unknown' : 'write-error'); throw new Error('Clipboard setting was not committed'); }
	reportStorageHealth(settingsStorageHealthOwner, null);
}

/**
 * Domain admission policy: never evict pinned entries, cap entry count and
 * encoded bytes. Throws when only pinned data could satisfy the request.
 */
function admitClipboardItem(history: ClipboardItem[], newItem: ClipboardItem): ClipboardItem[] {
	if (history[0]?.text === newItem.text) return history;

	const pinned = history.filter((h) => h.pinned);
	const unpinned = history.filter((h) => !h.pinned && h.text !== newItem.text);

	if (pinned.length >= MAX_HISTORY) throw new Error('Clipboard history is full of pinned entries. Unpin an entry before adding another.');
	if (clipboardHistoryBytes([...pinned, newItem]) > MAX_HISTORY_BYTES) {
		throw new Error('Clipboard item exceeds the history byte budget even without unpinned entries.');
	}

	// Newest-first unpinned candidates; the new item leads so it is never evicted.
	const kept: ClipboardItem[] = [newItem, ...unpinned];
	while (pinned.length + kept.length > MAX_HISTORY || clipboardHistoryBytes([...pinned, ...kept]) > MAX_HISTORY_BYTES) {
		if (kept.length <= 1) throw new Error('Clipboard pinned entries exceed the history byte budget. Unpin an entry to continue.');
		kept.pop();
	}
	return [...pinned, ...kept];
}

const MAX_MUTATION_ATTEMPTS = 3;

/**
 * Run one history mutation as a conditional read-modify-write. On a concurrent
 * change the same mutation is re-applied to the freshly stored list, so entries
 * appended by another context survive alongside this one.
 */
async function mutateClipboardHistory(mutate: (history: ClipboardItem[]) => ClipboardItem[]): Promise<ClipboardItem[]> {
	let base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt++) {
		const next = mutate(parseClipboardHistory(base.value));
		const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
			area: 'local',
			baseRevision: base.revision,
			value: next,
			remerge: (current, remergeAttempt) => {
				if (remergeAttempt >= MAX_MUTATION_ATTEMPTS) return null;
				try { return mutate(parseClipboardHistory(current)); } catch { return null; }
			},
		});
		if (outcome.kind === 'committed') return parseClipboardHistory(outcome.value);
		if (outcome.kind === 'external') {
			if (outcome.revision === base.revision) return parseClipboardHistory(base.value);
			base = { value: parseClipboardHistory(outcome.value), revision: outcome.revision };
			continue;
		}
		throw new Error('Clipboard history update was not committed; the stored history is unchanged.');
	}
	return parseClipboardHistory(base.value);
}

/**
 * Save text to history
 */
export async function saveToClipboardHistory(
	text: string,
	sourceUrl?: string,
	sourceTitle?: string
): Promise<ClipboardItem[]> {
	if (!text?.trim()) return await getClipboardHistory();

	return mutateClipboardHistory((history) => admitClipboardItem(history, {
		id: crypto.randomUUID(),
		text,
		timestamp: Date.now(),
		pinned: false,
		...(sourceUrl ? { sourceUrl } : {}),
		...(sourceTitle ? { sourceTitle } : {}),
	}));
}

/**
 * Get history
 */
export async function getClipboardHistory(): Promise<ClipboardItem[]> {
	const entry = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	return parseClipboardHistory(entry.value);
}

/**
 * Toggle pin status
 */
export async function togglePin(id: string): Promise<ClipboardItem[]> {
	return mutateClipboardHistory((history) => {
		const updated = history.map(item =>
			item.id === id ? { ...item, pinned: !item.pinned } : item
		);

		// Sort: pinned first
		updated.sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return b.timestamp - a.timestamp;
		});
		return updated;
	});
}

/**
 * Delete an item
 */
export async function deleteItem(id: string): Promise<ClipboardItem[]> {
	return mutateClipboardHistory((history) => history.filter(item => item.id !== id));
}

/**
 * Clear all unpinned items
 */
export async function clearUnpinned(): Promise<ClipboardItem[]> {
	return mutateClipboardHistory((history) => history.filter(item => item.pinned));
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
