// goal: Resource Manager for on-demand asset loading + caching
// eff: Helpers extracted to external files

import { createLogger } from '@nexus/kernel';
import type { ResourceEntry, ResourceMetadata, DownloadProgress } from '../core/resource-types';
import { openDB, computeHash, fetchWithProgress, STORE_NAME } from '../utils/resource-utils';
import { withStorageTimeout } from '../core/safe-storage';

const logger = createLogger('ResourceManager', 'HALO');

export class ResourceManager {
	private db: IDBDatabase | null = null;

	private async ensureDB(): Promise<IDBDatabase | null> {
		if (this.db) return this.db;
		this.db = await withStorageTimeout(() => openDB(), null, 'IndexedDB:open');
		return this.db;
	}

	// Get cached resource by ID
	async get(id: string): Promise<ResourceEntry | null> {
		const db = await this.ensureDB();
		if (!db) return null;

		return withStorageTimeout(async () => {
			return new Promise<ResourceEntry | null>((resolve) => {
				const tx = db.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);
				const req = store.get(id);
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => resolve(null);
			});
		}, null, `IndexedDB:get(${id})`);
	}

	// Check if resource exists with valid hash
	async has(id: string, expectedHash?: string): Promise<boolean> {
		const entry = await this.get(id);
		if (!entry) return false;
		if (expectedHash && entry.hash !== expectedHash) return false;
		return true;
	}

	// Download and cache resource
	async download(
		id: string,
		url: string,
		expectedHash: string,
		type: ResourceMetadata['type'],
		onProgress?: (p: DownloadProgress) => void
	): Promise<ArrayBuffer> {
		// Return cached if valid
		const cached = await this.get(id);
		if (cached && cached.hash === expectedHash) {
			logger.info(`Cache hit: ${id}`);
			return cached.data;
		}

		logger.info(`Downloading: ${id} from ${url}`);

		// Network download with timeout
		const data = await withStorageTimeout(
			() => fetchWithProgress(url, onProgress),
			null as unknown as ArrayBuffer, // fallback
			`Network:fetch(${id})`
		);

		if (!data) {
			throw new Error(`Failed to download resource ${id} from ${url} (timeout or network error)`);
		}

		const actualHash = await computeHash(data);
		if (actualHash !== expectedHash) {
			throw new Error(`Hash mismatch for ${id}: expected ${expectedHash}, got ${actualHash}`);
		}

		// Store in IndexedDB with timeout
		const entry: ResourceEntry = {
			id, url, hash: actualHash, size: data.byteLength,
			type, downloadedAt: Date.now(), data,
		};

		const db = await this.ensureDB();
		if (db) {
			await withStorageTimeout(async () => {
				return new Promise<void>((resolve, reject) => {
					const tx = db.transaction(STORE_NAME, 'readwrite');
					const store = tx.objectStore(STORE_NAME);
					const req = store.put(entry);
					req.onsuccess = () => resolve();
					req.onerror = () => reject(req.error);
				});
			}, undefined, `IndexedDB:put(${id})`);
			logger.info(`Cached: ${id} (${(data.byteLength / 1024).toFixed(1)} KB)`);
		} else {
			logger.warn(`Skipping cache for ${id}: IndexedDB unavailable`);
		}

		return data;
	}

	// Delete resource by ID
	async delete(id: string): Promise<void> {
		const db = await this.ensureDB();
		if (!db) return;

		await withStorageTimeout(async () => {
			return new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				const store = tx.objectStore(STORE_NAME);
				const req = store.delete(id);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
			});
		}, undefined, `IndexedDB:delete(${id})`);
		logger.info(`Deleted: ${id}`);
	}

	// List all cached resources (metadata only)
	async list(): Promise<ResourceMetadata[]> {
		const db = await this.ensureDB();
		if (!db) return [];

		return withStorageTimeout(async () => {
			return new Promise<ResourceMetadata[]>((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);
				const req = store.getAll();
				req.onsuccess = () => {
					const entries = req.result as ResourceEntry[];
					// Strip data for metadata only
					resolve(entries.map(({ data, ...meta }) => meta));
				};
				req.onerror = () => reject(req.error);
			});
		}, [], 'IndexedDB:list');
	}

	// Clear all cached resources
	async clear(): Promise<void> {
		const db = await this.ensureDB();
		if (!db) return;

		await withStorageTimeout(async () => {
			return new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				const store = tx.objectStore(STORE_NAME);
				const req = store.clear();
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
			});
		}, undefined, 'IndexedDB:clear');
		logger.info('Cache cleared');
	}
}

// Singleton instance
export const resourceManager = new ResourceManager();
