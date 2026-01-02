// goal: IndexedDB persistence for Module Manager

import type { ModuleState } from '../registry/module-registry';

const DB_NAME = 'halo-modules';
const DB_VERSION = 1;
const STORE_NAME = 'module-state';
const DB_OPEN_TIMEOUT = 3000;

export let useMemoryMode = false;

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<T>((resolve) => setTimeout(() => {
			console.warn('[ModuleDB] IndexedDB timeout, switching to memory mode');
			useMemoryMode = true;
			resolve(fallback);
		}, ms))
	]);
};

const openDB = (): Promise<IDBDatabase | null> => {
	if (useMemoryMode) return Promise.resolve(null);

	const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		try {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
			};
		} catch (e) { reject(e); }
	});

	return withTimeout(dbPromise, DB_OPEN_TIMEOUT, null as unknown as IDBDatabase)
		.catch(() => { useMemoryMode = true; return null; });
};

export const getAllStates = async (): Promise<ModuleState[]> => {
	if (useMemoryMode) return [];
	const db = await openDB();
	if (!db) return [];
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		request.onsuccess = () => resolve(request.result || []);
		request.onerror = () => reject(request.error);
	});
};

export const saveState = async (state: ModuleState): Promise<void> => {
	if (useMemoryMode) return;
	const db = await openDB();
	if (!db) return;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.put(state);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
};

export const deleteState = async (id: string): Promise<void> => {
	if (useMemoryMode) return;
	const db = await openDB();
	if (!db) return;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const request = store.delete(id);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
};
