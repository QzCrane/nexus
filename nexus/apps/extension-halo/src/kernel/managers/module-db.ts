// goal: IndexedDB persistence for Module Manager

import type { ModuleState } from '../registry/module-registry';

const DB_NAME = 'halo-modules';
const DB_VERSION = 1;
const STORE_NAME = 'module-state';
const DB_OPEN_TIMEOUT = 3000;
const MAX_RETRIES = 3;

export let useMemoryMode = false;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// rule: singleton IDBDatabase handle — the previous openDB() returned a fresh handle per
// CRUD op and never called db.close(), so each operation leaked a connection. Browsers cap
// concurrent IDB connections per origin, so sustained use exhausted the pool.
let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase | null> | null = null;

const openDB = async (): Promise<IDBDatabase | null> => {
	if (useMemoryMode) return null;
	if (dbInstance) return dbInstance;
	if (dbOpenPromise) return dbOpenPromise;

	dbOpenPromise = (async () => {
		let lastError: unknown;

		for (let i = 0; i < MAX_RETRIES; i++) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
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
					} catch (error) { reject(error); }
				});

				const result = await Promise.race([
					dbPromise,
					new Promise<IDBDatabase>((_, reject) => {
						timer = setTimeout(() => reject(new Error('timeout')), DB_OPEN_TIMEOUT);
					})
				]);
				if (timer !== undefined) clearTimeout(timer);
				dbInstance = result;
				dbInstance.onclose = () => { dbInstance = null; dbOpenPromise = null; };
				dbInstance.onversionchange = () => { dbInstance?.close(); dbInstance = null; dbOpenPromise = null; };
				return dbInstance;
			} catch (error) {
				if (timer !== undefined) clearTimeout(timer);
				lastError = error;
				if (i < MAX_RETRIES - 1) {
					const delay = 500 * (i + 1);
					console.warn(`[ModuleDB] IndexedDB init attempt ${i + 1} failed/timed out, retrying in ${delay}ms...`);
					await wait(delay);
				}
			}
		}

		console.warn('[ModuleDB] IndexedDB initialization failed, switching to memory mode. Error:', lastError);
		useMemoryMode = true;
		dbOpenPromise = null;
		return null;
	})();

	return dbOpenPromise;
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

export const saveStates = async (states: readonly ModuleState[]): Promise<void> => {
	if (useMemoryMode || states.length === 0) return;
	const db = await openDB();
	if (!db) return;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		for (const state of states) store.put(state);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Module state transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('Module state transaction aborted'));
	});
};

export const saveState = async (state: ModuleState): Promise<void> => {
	await saveStates([state]);
};

export const deleteState = async (id: string): Promise<void> => {
	if (useMemoryMode) return;
	const db = await openDB();
	if (!db) return;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		store.delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Module deletion transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('Module deletion transaction aborted'));
	});
};
