// goal: Archive core logic using chrome.pageCapture API + IndexedDB.
// The metadata list in chrome.storage and the MHTML blobs in IndexedDB are
// reconciled in a fixed order: blob first, metadata second, rollback on
// metadata failure, and an explicit orphan sweep for older damage.

import { conditionalLedgerWrite, readLedgerEntry } from '@nexus/kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { ArchiveEntry } from './types';
import { saveMHTMLBlob, getMHTMLBlob, deleteMHTMLBlob, deleteMHTMLBlobs, getAllBlobIds } from './storage';
import { downloadBlob } from '../../kernel/utils/object-url-lease';

const STORAGE_KEY = 'halo_archive_entries';
export const MAX_ARCHIVE_ENTRIES = 50;
const MAX_MUTATION_ATTEMPTS = 3;

function archiveEntry(value: unknown): ArchiveEntry | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
	if (typeof candidate.title !== 'string' || typeof candidate.url !== 'string') return null;
	if (!Number.isSafeInteger(candidate.savedAt) || (candidate.savedAt as number) < 0) return null;
	if (!Number.isSafeInteger(candidate.size) || (candidate.size as number) < 0) return null;
	return { id: candidate.id, title: candidate.title, url: candidate.url, savedAt: candidate.savedAt as number, size: candidate.size as number };
}

export const archiveLastCodec: ToolStateCodec<ArchiveEntry | null> = {
	decode(value) {
		const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
			&& (value as Record<string, unknown>).version === 1
			? (value as Record<string, unknown>).value
			: value;
		if (raw === null) return { kind: 'valid', value: null };
		const parsed = archiveEntry(raw);
		return parsed
			? { kind: 'valid', value: parsed }
			: { kind: 'invalid', reason: 'Last archive metadata has invalid identity, text, timestamp, or size.' };
	},
	encode(value) { return { version: 1, value }; },
};

/**
 * Sole missing/malformed-storage policy for the metadata list. Entries that do
 * not satisfy the domain contract are dropped, never shape-coerced.
 */
export function parseArchiveEntries(value: unknown): ArchiveEntry[] {
	if (!Array.isArray(value)) return [];
	const parsed: ArchiveEntry[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
		const candidate = archiveEntry(entry);
		if (candidate) parsed.push(candidate);
	}
	return parsed;
}

async function mutateEntries(mutate: (stored: ArchiveEntry[]) => ArchiveEntry[]): Promise<ArchiveEntry[]> {
	let base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt++) {
		const next = mutate(parseArchiveEntries(base.value));
		const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
			area: 'local',
			baseRevision: base.revision,
			value: next,
			remerge: (current, remergeAttempt) => {
				if (remergeAttempt >= MAX_MUTATION_ATTEMPTS) return null;
				return mutate(parseArchiveEntries(current));
			},
		});
		if (outcome.kind === 'committed') return parseArchiveEntries(outcome.value);
		if (outcome.kind === 'external') {
			if (outcome.revision === base.revision) return parseArchiveEntries(base.value);
			base = { value: parseArchiveEntries(outcome.value), revision: outcome.revision };
			continue;
		}
		throw new Error('Archive metadata update was not committed; the stored list is unchanged.');
	}
	return parseArchiveEntries(base.value);
}

// Capture current page as MHTML and store blob plus metadata as one logical unit
export async function captureCurrentPage(): Promise<ArchiveEntry> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id || !tab.url) throw new Error('No active tab');

		// pageCapture returns MHTML as Blob
		const mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id });
		if (!mhtmlBlob) throw new Error('Capture failed');

		const id = crypto.randomUUID();
		const entry: ArchiveEntry = {
			id,
			title: tab.title || 'Untitled',
			url: tab.url,
			savedAt: Date.now(),
			size: mhtmlBlob.size,
		};

		await saveMHTMLBlob(id, mhtmlBlob);
		try {
			await saveEntryMeta(entry);
		} catch (metaError) {
			// Metadata did not commit: remove the just-written blob so the two
			// stores never disagree about this entry. A failed rollback must stay
			// visible because it leaves a concrete orphan for reconciliation.
			try {
				await deleteMHTMLBlob(id);
			} catch (rollbackError) {
				throw new AggregateError(
					[metaError, rollbackError],
					`Archive metadata commit failed and blob rollback failed for ${id}.`,
				);
			}
			throw metaError;
		}

		return entry;
	} catch (error) {
		console.error('[HALO:Archive] Capture failed:', error);
		throw error;
	}
}

// Download MHTML file
export async function downloadArchive(entry: ArchiveEntry): Promise<void> {
	const blob = await getMHTMLBlob(entry.id);
	if (!blob) throw new Error('Archive content was not found in local storage.');

	const filename = `${sanitizeFilename(entry.title)}_${formatDate(entry.savedAt)}.mhtml`;
	downloadBlob(blob, filename);
}

// Save entry metadata, trim the list to its ceiling, and delete the blobs of
// trimmed entries so trimming cannot leave orphans behind.
export async function saveEntryMeta(entry: ArchiveEntry): Promise<ArchiveEntry[]> {
	let base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt++) {
		const stored = parseArchiveEntries(base.value);
		const updated = [entry, ...stored.filter((e) => e.id !== entry.id)];
		const kept = updated.slice(0, MAX_ARCHIVE_ENTRIES);
		const trimmedIds = updated.slice(MAX_ARCHIVE_ENTRIES).map((e) => e.id);
		const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
			area: 'local',
			baseRevision: base.revision,
			value: kept,
			remerge: (current, remergeAttempt) => {
				if (remergeAttempt >= MAX_MUTATION_ATTEMPTS) return null;
				const refreshed = [entry, ...parseArchiveEntries(current).filter((e) => e.id !== entry.id)];
				return refreshed.slice(0, MAX_ARCHIVE_ENTRIES);
			},
		});
		if (outcome.kind === 'committed' || outcome.kind === 'external') {
			if (trimmedIds.length > 0) {
				// A failed blob cleanup is recovered by the orphan sweep, not silenced.
				await deleteMHTMLBlobs(trimmedIds).catch((error) => {
					console.error('[HALO:Archive] Trimmed blob cleanup failed:', error);
				});
			}
			if (outcome.kind === 'committed') return parseArchiveEntries(outcome.value);
			if (outcome.revision === base.revision) return parseArchiveEntries(base.value);
			base = { value: parseArchiveEntries(outcome.value), revision: outcome.revision };
			continue;
		}
		throw new Error('Archive metadata update was not committed; the stored list is unchanged.');
	}
	return parseArchiveEntries(base.value);
}

// Get stored entries (metadata only)
export async function getStoredEntries(): Promise<ArchiveEntry[]> {
	const entry = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	return parseArchiveEntries(entry.value);
}

// Delete entry (both metadata and blob)
export async function deleteEntry(id: string): Promise<ArchiveEntry[]> {
	// The blob goes first: a metadata failure then leaves an entry whose blob is
	// gone (surfaced by the viewer alert), never an unreferenced orphan.
	await deleteMHTMLBlob(id);
	return mutateEntries((stored) => stored.filter((e) => e.id !== id));
}

/**
 * Delete blobs that no longer have a metadata entry, up to a bounded count per
 * run. Returns how many orphans were removed; storage failures propagate.
 */
export async function reconcileArchiveOrphans(): Promise<number> {
	const entries = await getStoredEntries();
	const known = new Set(entries.map((e) => e.id));
	const blobs = await getAllBlobIds();
	const orphanIds = blobs.filter((blob) => !known.has(blob.id)).map((blob) => blob.id).slice(0, 50);
	if (orphanIds.length > 0) await deleteMHTMLBlobs(orphanIds);
	return orphanIds.length;
}

// Utilities
function sanitizeFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '_').slice(0, 50);
}

function formatDate(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
