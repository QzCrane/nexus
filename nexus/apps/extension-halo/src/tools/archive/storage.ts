// goal: Archive IndexedDB storage for MHTML blobs with transaction-completion
// semantics: a request's success alone is not treated as a committed mutation.

import type { ArchiveEntry } from './types';

const DB_NAME = 'halo_archive_db';
const DB_VERSION = 1;
const STORE_NAME = 'mhtml_blobs';

let dbInstance: IDBDatabase | null = null;

export function closeArchiveDB(): void {
	if (dbInstance) {
		dbInstance.close();
		dbInstance = null;
	}
}

// Open IndexedDB
async function openDB(): Promise<IDBDatabase> {
	if (dbInstance) return dbInstance;

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			dbInstance = request.result;
			dbInstance.addEventListener('versionchange', () => closeArchiveDB());
			resolve(dbInstance);
		};
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

// Resolve only when the surrounding transaction has committed; an abort or a
// transaction-level error rejects even when individual requests succeeded.
function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
	});
}

// Save MHTML blob to IndexedDB
export async function saveMHTMLBlob(id: string, blob: Blob): Promise<void> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	tx.objectStore(STORE_NAME).put({ id, blob, savedAt: Date.now() });
	await transactionDone(tx);
}

// Get MHTML blob from IndexedDB
export async function getMHTMLBlob(id: string): Promise<Blob | null> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readonly');
	const result = await requestValue(tx.objectStore(STORE_NAME).get(id));
	await transactionDone(tx);
	return result?.blob || null;
}

// Delete MHTML blob from IndexedDB
export async function deleteMHTMLBlob(id: string): Promise<void> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	tx.objectStore(STORE_NAME).delete(id);
	await transactionDone(tx);
}

// Delete several blobs in one committed transaction
export async function deleteMHTMLBlobs(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	for (const id of ids) store.delete(id);
	await transactionDone(tx);
}

// Get all stored blob IDs with sizes
export async function getAllBlobIds(): Promise<{ id: string; size: number }[]> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readonly');
	const items = await requestValue(tx.objectStore(STORE_NAME).getAll());
	await transactionDone(tx);
	return (items || []).map((item: { id: string; blob: Blob }) => ({ id: item.id, size: item.blob?.size || 0 }));
}

// Open MHTML in new tab (Chrome can render MHTML natively)
export async function openMHTMLInNewTab(entry: ArchiveEntry): Promise<void> {
	const blob = await getMHTMLBlob(entry.id);
	if (!blob) {
		console.warn('[HALO:Archive] Blob not found for:', entry.id);
		return;
	}
	const url = URL.createObjectURL(blob);
	chrome.tabs.create({ url });
}
