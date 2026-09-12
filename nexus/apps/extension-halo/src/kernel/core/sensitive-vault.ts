// goal: trusted extension-origin persistence for explicitly saved sensitive data

const DB_NAME = 'halo_sensitive_vault';
const DB_VERSION = 1;
const STORE_NAME = 'records';
let database: IDBDatabase | null = null;

export interface SensitiveVaultRecord {
	readonly id: string;
	readonly version: 1;
	readonly value: unknown;
	readonly updatedAt: number;
	readonly migration?: { readonly legacyKeys: readonly string[]; readonly sourceFingerprint: string };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error ?? new Error('Sensitive vault transaction aborted'));
		transaction.onerror = () => reject(transaction.error ?? new Error('Sensitive vault transaction failed'));
	});
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Sensitive vault request failed'));
	});
}

async function openVault(): Promise<IDBDatabase> {
	if (database) return database;
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error ?? new Error('Sensitive vault open failed'));
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
		};
		request.onsuccess = () => {
			database = request.result;
			database.addEventListener('versionchange', () => { database?.close(); database = null; });
			resolve(database);
		};
	});
}

export async function readSensitiveVault(id: string): Promise<SensitiveVaultRecord | null> {
	const db = await openVault();
	const transaction = db.transaction(STORE_NAME, 'readonly');
	const record = await requestValue(transaction.objectStore(STORE_NAME).get(id));
	await transactionDone(transaction);
	return record ?? null;
}

export async function writeSensitiveVault(
	id: string,
	value: unknown,
	migration?: SensitiveVaultRecord['migration'],
): Promise<void> {
	const snapshot = structuredClone({ id, version: 1 as const, value, updatedAt: Date.now(), ...(migration ? { migration } : {}) });
	const db = await openVault();
	const transaction = db.transaction(STORE_NAME, 'readwrite');
	transaction.objectStore(STORE_NAME).put(snapshot);
	await transactionDone(transaction);
	const readback = await readSensitiveVault(id);
	if (!readback || JSON.stringify(readback.value) !== JSON.stringify(snapshot.value)) {
		throw new Error('Sensitive vault readback did not match the committed value');
	}
}
