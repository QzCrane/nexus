// goal: Module manager core logic
// eff: Install/uninstall/update modules with IndexedDB persistence

import { CORE_MODULES, OPTIONAL_MODULES, ALL_MODULES, type ModuleState, type ModuleManagerState, type ModuleMeta } from '../registry/module-registry';

const DB_NAME = 'halo-modules';
const DB_VERSION = 1;
const STORE_NAME = 'module-state';
const DB_OPEN_TIMEOUT = 3000; // 3 seconds timeout for IndexedDB

// Flag to track if IndexedDB is available
let useMemoryMode = false;

// Promise with timeout helper
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<T>((resolve) => setTimeout(() => {
			console.warn('[ModuleManager] IndexedDB timeout, switching to memory mode');
			useMemoryMode = true;
			resolve(fallback);
		}, ms))
	]);
};

// Open IndexedDB with timeout
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
		} catch (e) {
			reject(e);
		}
	});

	return withTimeout(dbPromise, DB_OPEN_TIMEOUT, null as unknown as IDBDatabase)
		.catch(() => {
			useMemoryMode = true;
			return null;
		});
};

// Get all module states from IndexedDB
const getAllStates = async (): Promise<ModuleState[]> => {
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

// Save module state to IndexedDB
const saveState = async (state: ModuleState): Promise<void> => {
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

// Delete module state from IndexedDB
const deleteState = async (id: string): Promise<void> => {
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

// Module manager class
export class ModuleManager {
	private states: Map<string, ModuleState> = new Map();
	private listeners: Set<() => void> = new Set();

	async initialize(): Promise<void> {
		console.log('[ModuleManager] Initializing...');
		const stored = await getAllStates();
		console.log(`[ModuleManager] Got ${stored.length} stored states, memoryMode=${useMemoryMode}`);
		stored.forEach((s) => this.states.set(s.id, s));

		// Ensure all modules are installed by default (as per user request: "all modules must be loaded")
		// In memory mode, just set all modules as installed without persistence
		for (const mod of ALL_MODULES) {
			if (!this.states.has(mod.id)) {
				const state: ModuleState = { id: mod.id, status: 'installed', installedVersion: mod.version, installedAt: Date.now() };
				this.states.set(mod.id, state);
				// Only persist if not in memory mode (saveState will early-return if useMemoryMode is true)
				if (!useMemoryMode) {
					await saveState(state);
				}
			}
		}
		console.log(`[ModuleManager] Initialized with ${this.states.size} modules`);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((l) => l());
	}

	getState(id: string): ModuleState | undefined {
		return this.states.get(id);
	}

	getAllStates(): ModuleState[] {
		return Array.from(this.states.values());
	}

	isInstalled(id: string): boolean {
		const state = this.states.get(id);
		return state?.status === 'installed';
	}

	getInstalledModules(): ModuleMeta[] {
		return ALL_MODULES.filter((m) => this.isInstalled(m.id));
	}

	getAvailableModules(): ModuleMeta[] {
		return OPTIONAL_MODULES.filter((m) => !this.isInstalled(m.id));
	}

	async install(id: string): Promise<void> {
		const meta = ALL_MODULES.find((m) => m.id === id);
		if (!meta) throw new Error(`Module ${id} not found`);

		// Update state to downloading
		const state: ModuleState = { id, status: 'downloading' };
		this.states.set(id, state);
		await saveState(state);
		this.notify();

		try {
			// Simulate download delay (replace with actual download logic)
			await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

			// Mark as installed
			const installed: ModuleState = { id, status: 'installed', installedVersion: meta.version, installedAt: Date.now() };
			this.states.set(id, installed);
			await saveState(installed);
			this.notify();
		} catch (err) {
			const error: ModuleState = { id, status: 'error', error: (err as Error).message };
			this.states.set(id, error);
			await saveState(error);
			this.notify();
			throw err;
		}
	}

	async uninstall(id: string): Promise<void> {
		const meta = ALL_MODULES.find((m) => m.id === id);
		if (!meta) throw new Error(`Module ${id} not found`);
		if (meta.builtIn) throw new Error(`Cannot uninstall core module: ${id}`);

		this.states.delete(id);
		await deleteState(id);
		this.notify();
	}

	async update(id: string): Promise<void> {
		const state = this.states.get(id);
		if (!state || state.status !== 'installed') throw new Error(`Module ${id} not installed`);

		// Set status to updating
		state.status = 'updating';
		this.states.set(id, { ...state });
		await saveState(state);
		this.notify();

		// Re-install
		await this.install(id);
	}
}

// Singleton instance
let instance: ModuleManager | null = null;

export const getModuleManager = async (): Promise<ModuleManager> => {
	if (!instance) {
		instance = new ModuleManager();
		await instance.initialize();
	}
	return instance;
};
