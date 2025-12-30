// goal: Resource Manager for on-demand asset loading + caching
// tradeoff: IndexedDB for persistence, Hash verify for integrity

import { createLogger } from '@nexus/kernel';

const logger = createLogger('ResourceManager', 'HALO');

const DB_NAME = 'halo_resources';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export interface ResourceMetadata {
	id: string;
	url: string;
	hash: string;
	size: number;
	type: 'wasm' | 'model' | 'script' | 'data';
	downloadedAt: number;
}

export interface ResourceEntry extends ResourceMetadata {
	data: ArrayBuffer;
}

export type DownloadProgress = {
	loaded: number;
	total: number;
	percent: number;
};

// Open IndexedDB connection
const openDB = (): Promise<IDBDatabase> => {
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
const computeHash = async (buffer: ArrayBuffer): Promise<string> => {
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Fetch resource with progress tracking
const fetchWithProgress = async (
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
