// goal: Resource Manager for on-demand asset loading + caching
// eff: Helpers extracted to external files

import { createLogger } from '@nexus/kernel';
import type { ResourceEntry, ResourceMetadata, DownloadProgress } from '../core/resource-types';
import { openDB, computeHash, fetchWithProgress, STORE_NAME } from '../utils/resource-utils';

const logger = createLogger('ResourceManager', 'HALO');

export class ResourceManager {
	private db: IDBDatabase | null = null;

	private async ensureDB(): Promise<IDBDatabase> {
		if (!this.db) this.db = await openDB();
		return this.db;
	}

	// Get cached resource by ID
	async get(id: string): Promise<ResourceEntry | null> {
		const db = await this.ensureDB();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(id);
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		});
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
		const data = await fetchWithProgress(url, onProgress);
		const actualHash = await computeHash(data);

		if (actualHash !== expectedHash) {
			throw new Error(`Hash mismatch for ${id}: expected ${expectedHash}, got ${actualHash}`);
		}

		// Store in IndexedDB
		const entry: ResourceEntry = {
			id,
			url,
			hash: actualHash,
			size: data.byteLength,
			type,
			downloadedAt: Date.now(),
			data,
		};

		const db = await this.ensureDB();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.put(entry);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});

		logger.info(`Cached: ${id} (${(data.byteLength / 1024).toFixed(1)} KB)`);
		return data;
	}

	// Delete resource by ID
	async delete(id: string): Promise<void> {
		const db = await this.ensureDB();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.delete(id);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
		logger.info(`Deleted: ${id}`);
	}

	// List all cached resources (metadata only)
	async list(): Promise<ResourceMetadata[]> {
		const db = await this.ensureDB();
		return new Promise((resolve, reject) => {
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
	}

	// Clear all cached resources
	async clear(): Promise<void> {
		const db = await this.ensureDB();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.clear();
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
		logger.info('Cache cleared');
	}
}

// Singleton instance
export const resourceManager = new ResourceManager();
