// goal: Module manager core logic
// eff: Install/uninstall/update modules with persistence

import { ALL_MODULES, OPTIONAL_MODULES, type ModuleState, type ModuleMeta } from '../registry/module-registry';
import { getAllStates, saveState, deleteState, useMemoryMode } from './module-db';

export class ModuleManager {
	private states: Map<string, ModuleState> = new Map();
	private listeners: Set<() => void> = new Set();

	async initialize(): Promise<void> {
		const stored = await getAllStates();
		stored.forEach((s) => this.states.set(s.id, s));

		for (const mod of ALL_MODULES) {
			if (!this.states.has(mod.id)) {
				const state: ModuleState = { id: mod.id, status: 'installed', installedVersion: mod.version, installedAt: Date.now() };
				this.states.set(mod.id, state);
				if (!useMemoryMode) await saveState(state);
			}
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void { this.listeners.forEach((l) => l()); }

	getState(id: string): ModuleState | undefined { return this.states.get(id); }
	getAllStates(): ModuleState[] { return Array.from(this.states.values()); }
	isInstalled(id: string): boolean { return this.states.get(id)?.status === 'installed'; }
	getInstalledModules(): ModuleMeta[] { return ALL_MODULES.filter((m) => this.isInstalled(m.id)); }
	getAvailableModules(): ModuleMeta[] { return OPTIONAL_MODULES.filter((m) => !this.isInstalled(m.id)); }

	async install(id: string): Promise<void> {
		const meta = ALL_MODULES.find((m) => m.id === id);
		if (!meta) throw new Error(`Module ${id} not found`);

		const state: ModuleState = { id, status: 'downloading' };
		this.states.set(id, state);
		await saveState(state);
		this.notify();

		try {
			await new Promise((r) => setTimeout(r, 300)); // Sim delay
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
		if (!meta || meta.builtIn) throw new Error(`Cannot uninstall: ${id}`);
		this.states.delete(id);
		await deleteState(id);
		this.notify();
	}

	async update(id: string): Promise<void> {
		const state = this.states.get(id);
		if (!state || state.status !== 'installed') throw new Error(`Not installed: ${id}`);
		state.status = 'updating';
		this.states.set(id, { ...state });
		await saveState(state);
		this.notify();
		await this.install(id);
	}
}

let instance: ModuleManager | null = null;
export const getModuleManager = async (): Promise<ModuleManager> => {
	if (!instance) {
		instance = new ModuleManager();
		await instance.initialize();
	}
	return instance;
};
