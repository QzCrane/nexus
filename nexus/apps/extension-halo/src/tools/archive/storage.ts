// goal: Archive IndexedDB storage for MHTML blobs

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

// Save MHTML blob to IndexedDB
export async function saveMHTMLBlob(id: string, blob: Blob): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.put({ id, blob, savedAt: Date.now() });
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

// Get MHTML blob from IndexedDB
export async function getMHTMLBlob(id: string): Promise<Blob | null> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(id);
		request.onsuccess = () => resolve(request.result?.blob || null);
		request.onerror = () => reject(request.error);
	});
}

// Delete MHTML blob from IndexedDB
export async function deleteMHTMLBlob(id: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.delete(id);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

// Get all stored blob IDs with sizes
export async function getAllBlobIds(): Promise<{ id: string; size: number }[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		request.onsuccess = () => {
			const items = request.result || [];
			resolve(items.map((item: { id: string; blob: Blob }) => ({ id: item.id, size: item.blob?.size || 0 })));
		};
		request.onerror = () => reject(request.error);
	});
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
