// goal: IndexedDB persistence for Module Manager

import type { ModuleState } from '../registry/module-registry';

const DB_NAME = 'halo-modules';
const DB_VERSION = 1;
const STORE_NAME = 'module-state';
const DB_OPEN_TIMEOUT = 3000;
const MAX_RETRIES = 3;

export let useMemoryMode = false;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const openDB = async (): Promise<IDBDatabase | null> => {
	if (useMemoryMode) return null;

	let lastError: any;

	for (let i = 0; i < MAX_RETRIES; i++) {
		try {
			// Create a fresh promise for each attempt
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

			return await Promise.race([
				dbPromise,
				new Promise<IDBDatabase>((_, reject) =>
					setTimeout(() => reject(new Error('timeout')), DB_OPEN_TIMEOUT)
				)
			]);

		} catch (e) {
			lastError = e;
			if (i < MAX_RETRIES - 1) {
				const delay = 500 * (i + 1);
				console.warn(`[ModuleDB] IndexedDB init attempt ${i + 1} failed/timed out, retrying in ${delay}ms...`);
				await wait(delay);
			}
		}
	}

	console.warn('[ModuleDB] IndexedDB initialization failed, switching to memory mode. Error:', lastError);
	useMemoryMode = true;
	return null;
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
