// goal: Resource Manager Utilities
// eff: Extracted from resource-manager.ts

import type { DownloadProgress } from './resource-types';

export const DB_NAME = 'halo_resources';
export const DB_VERSION = 1;
export const STORE_NAME = 'assets';

// Open IndexedDB connection
export const openDB = (): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
};

// SHA-256 hash of ArrayBuffer
export const computeHash = async (buffer: ArrayBuffer): Promise<string> => {
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Fetch resource with progress tracking
export const fetchWithProgress = async (
	url: string,
	onProgress?: (p: DownloadProgress) => void
): Promise<ArrayBuffer> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);

	const total = parseInt(response.headers.get('Content-Length') || '0', 10);
	const reader = response.body?.getReader();
	if (!reader) throw new Error('ReadableStream not supported');

	const chunks: Uint8Array[] = [];
	let loaded = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.length;
		onProgress?.({ loaded, total, percent: total > 0 ? (loaded / total) * 100 : 0 });
	}

	const result = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result.buffer;
};
