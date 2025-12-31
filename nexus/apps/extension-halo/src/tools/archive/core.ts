// goal: Archive core logic using chrome.pageCapture API + IndexedDB

import type { ArchiveEntry } from './types';
import { saveMHTMLBlob, getMHTMLBlob, deleteMHTMLBlob } from './storage';

const STORAGE_KEY = 'halo_archive_entries';

// Capture current page as MHTML
export async function captureCurrentPage(): Promise<ArchiveEntry | null> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id || !tab.url) throw new Error('No active tab');

		// pageCapture returns MHTML as Blob
		const mhtmlBlob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id });
		if (!mhtmlBlob) throw new Error('Capture failed');

		const id = crypto.randomUUID();
		
		// Save blob to IndexedDB
		await saveMHTMLBlob(id, mhtmlBlob);

		const entry: ArchiveEntry = {
			id,
			title: tab.title || 'Untitled',
			url: tab.url,
			savedAt: Date.now(),
			size: mhtmlBlob.size,
		};

		return entry;
	} catch (error) {
		console.error('[HALO:Archive] Capture failed:', error);
		return null;
	}
}

// Download MHTML file
export async function downloadArchive(entry: ArchiveEntry): Promise<void> {
	const blob = await getMHTMLBlob(entry.id);
	if (!blob) return;
	
	const url = URL.createObjectURL(blob);
	const filename = `${sanitizeFilename(entry.title)}_${formatDate(entry.savedAt)}.mhtml`;
	
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// Open in viewer (new tab - Chrome renders MHTML natively)
export async function openInViewer(entry: ArchiveEntry): Promise<void> {
	const blob = await getMHTMLBlob(entry.id);
	if (!blob) {
		alert('Archive not found in local storage');
		return;
	}
	const url = URL.createObjectURL(blob);
	chrome.tabs.create({ url });
}

// Save entry metadata to storage
export async function saveEntryMeta(entry: ArchiveEntry): Promise<void> {
	const stored = await getStoredEntries();
	const meta = { id: entry.id, title: entry.title, url: entry.url, savedAt: entry.savedAt, size: entry.size };
	stored.unshift(meta as ArchiveEntry);
	if (stored.length > 50) stored.pop();
	await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

// Get stored entries (metadata only)
export async function getStoredEntries(): Promise<ArchiveEntry[]> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] || [];
}

// Delete entry (both metadata and blob)
export async function deleteEntry(id: string): Promise<void> {
	const stored = await getStoredEntries();
	const filtered = stored.filter((e) => e.id !== id);
	await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
	await deleteMHTMLBlob(id);
}

// Utilities
function sanitizeFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '_').slice(0, 50);
}

function formatDate(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
