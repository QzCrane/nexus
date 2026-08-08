// goal: Module manager core logic
// eff: Install/uninstall/update modules with persistence

import { ALL_MODULES, CORE_MODULES, OPTIONAL_MODULES, type ModuleState } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';
import { getAllStates, saveState, deleteState, useMemoryMode } from './module-db';

export interface ModuleStatePersistence {
	loadAll: () => Promise<ModuleState[]>;
	save: (state: ModuleState) => Promise<void>;
	remove: (id: string) => Promise<void>;
	shouldPersistSeed: () => boolean;
}

const DEFAULT_PERSISTENCE: ModuleStatePersistence = {
	loadAll: getAllStates,
	save: saveState,
	remove: deleteState,
	shouldPersistSeed: () => !useMemoryMode,
};

export function createMissingCoreModuleStates(
	existingIds: ReadonlySet<string>,
	installedAt = Date.now(),
): ModuleState[] {
	return CORE_MODULES
		.filter((module) => !existingIds.has(module.id))
		.map((module) => ({
			id: module.id,
			status: 'installed' as const,
			installedVersion: module.version,
			installedAt,
		}));
}

export class ModuleManager {
	private states: Map<string, ModuleState> = new Map();
	private listeners: Set<() => void> = new Set();
	private revision = 0;

	constructor(private readonly persistence: ModuleStatePersistence = DEFAULT_PERSISTENCE) {}

	async initialize(): Promise<void> {
		const stored = await this.persistence.loadAll();
		for (const state of stored) {
			this.states.set(state.id, state);
		}

		// Only built-in/core modules are implicit. Optional modules must remain
		// absent until the user installs them; deleting an optional state is the
		// durable representation of uninstall and must survive the next startup.
		const missingCoreStates = createMissingCoreModuleStates(new Set(this.states.keys()));
		for (const state of missingCoreStates) {
			this.states.set(state.id, state);
			if (this.persistence.shouldPersistSeed()) await this.persistence.save(state);
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getRevision(): number { return this.revision; }

	private notify(): void {
		this.revision++;
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	getState(id: string): ModuleState | undefined { return this.states.get(id); }
	getAllStates(): ModuleState[] { return Array.from(this.states.values()); }
	isInstalled(id: string): boolean { return this.states.get(id)?.status === 'installed'; }
	getInstalledModules(): ModuleMeta[] { return ALL_MODULES.filter((m) => this.isInstalled(m.id)); }
	getAvailableModules(): ModuleMeta[] { return OPTIONAL_MODULES.filter((m) => !this.isInstalled(m.id)); }

	async install(id: string): Promise<void> {
		const meta = ALL_MODULES.find((m) => m.id === id);
		if (!meta) throw new Error(`Module ${id} not found`);
		if (this.isInstalled(id)) return;

		const previous = this.states.get(id);
		const installed: ModuleState = {
			id,
			status: 'installed',
			installedVersion: meta.version,
			installedAt: Date.now(),
		};
		this.states.set(id, installed);
		try {
			// HALO modules are already packaged with the extension. Installation is
			// a local authority change, not a network download, so there is no fake
			// 300ms "downloading" delay in the production lifecycle.
			await this.persistence.save(installed);
		} catch (error) {
			if (previous) this.states.set(id, previous);
			else this.states.delete(id);
			throw error;
		}
		this.notify();
	}

	async uninstall(id: string): Promise<void> {
		const meta = ALL_MODULES.find((m) => m.id === id);
		if (!meta || meta.builtIn) throw new Error(`Cannot uninstall: ${id}`);
		const previous = this.states.get(id);
		if (!previous) return;

		this.states.delete(id);
		try {
			await this.persistence.remove(id);
		} catch (error) {
			this.states.set(id, previous);
			throw error;
		}
		this.notify();
	}

	async update(id: string): Promise<void> {
		const previous = this.states.get(id);
		if (previous?.status !== 'installed') throw new Error(`Not installed: ${id}`);
		const updating: ModuleState = { ...previous, status: 'updating' };
		this.states.set(id, updating);
		try {
			await this.persistence.save(updating);
		} catch (error) {
			this.states.set(id, previous);
			throw error;
		}
		this.notify();
		await this.install(id);
	}
}

let instance: ModuleManager | null = null;
let initPromise: Promise<ModuleManager> | null = null;
export const getModuleManager = async (): Promise<ModuleManager> => {
	if (instance) return instance;
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const m = new ModuleManager();
		await m.initialize();
		instance = m;
		initPromise = null;
		return m;
	})();
	// rule: on rejection, clear the cached promise so the next caller can retry.
	// Without this, a single initialize() failure permanently pinned initPromise
	// to a rejected Promise, and every subsequent getModuleManager() returned
	// the same rejection — the manager could never recover without a SW restart.
	initPromise.catch(() => { initPromise = null; });
	return initPromise;
};
