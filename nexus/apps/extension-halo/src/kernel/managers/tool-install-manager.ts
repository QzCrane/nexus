// goal: Tool installation manager core logic
// eff: Install/uninstall/update tools with persistence

import { ALL_TOOLS, OPTIONAL_TOOLS, type ToolInstallState } from '../registry/tool-registry';
import type { ToolMeta } from '../core/tool-registry-types';
import { getAllStates, saveState, deleteState, useMemoryMode } from './tool-install-db';

export class ToolInstallManager {
	private states: Map<string, ToolInstallState> = new Map();
	private listeners: Set<() => void> = new Set();

	async initialize(): Promise<void> {
		const stored = await getAllStates();
		stored.forEach((s) => this.states.set(s.id, s));

		for (const mod of ALL_TOOLS) {
			if (!this.states.has(mod.id)) {
				const state: ToolInstallState = { id: mod.id, status: 'installed', installedVersion: mod.version, installedAt: Date.now() };
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

	getState(id: string): ToolInstallState | undefined { return this.states.get(id); }
	getAllStates(): ToolInstallState[] { return Array.from(this.states.values()); }
	isInstalled(id: string): boolean { return this.states.get(id)?.status === 'installed'; }
	getInstalledTools(): ToolMeta[] { return ALL_TOOLS.filter((m) => this.isInstalled(m.id)); }
	getAvailableTools(): ToolMeta[] { return OPTIONAL_TOOLS.filter((m) => !this.isInstalled(m.id)); }

	async install(id: string): Promise<void> {
		const meta = ALL_TOOLS.find((m) => m.id === id);
		if (!meta) throw new Error(`Tool ${id} not found`);

		const state: ToolInstallState = { id, status: 'downloading' };
		this.states.set(id, state);
		await saveState(state);
		this.notify();

		try {
			await new Promise((r) => setTimeout(r, 300)); // Sim delay
			const installed: ToolInstallState = { id, status: 'installed', installedVersion: meta.version, installedAt: Date.now() };
			this.states.set(id, installed);
			await saveState(installed);
			this.notify();
		} catch (err) {
			const error: ToolInstallState = { id, status: 'error', error: (err as Error).message };
			this.states.set(id, error);
			await saveState(error);
			this.notify();
			throw err;
		}
	}

	async uninstall(id: string): Promise<void> {
		const meta = ALL_TOOLS.find((m) => m.id === id);
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

let instance: ToolInstallManager | null = null;
export const getToolInstallManager = async (): Promise<ToolInstallManager> => {
	if (!instance) {
		instance = new ToolInstallManager();
		await instance.initialize();
	}
	return instance;
};
