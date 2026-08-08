// goal: packaged-module enable/disable authority
// eff: one chrome.storage.local tombstone per optional module; all bundled modules start installed

import { ALL_MODULES, OPTIONAL_MODULES, type ModuleState } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';
import { readOptionalPackagedModuleEnabled } from '../core/module-installation-runtime';
import {
	isPackagedModuleMetaEnabled,
	moduleIdFromInstallationStorageKey,
	readDisabledPackagedModuleIds,
	writePackagedModuleEnabled,
} from './module-installation-store';

export interface ModuleInstallationPersistence {
	loadDisabled(): Promise<Set<string>>;
	readEnabled(id: string): Promise<boolean>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
	subscribe(listener: (id: string, enabled: boolean) => void): () => void;
}

function createChromePersistence(): ModuleInstallationPersistence {
	return {
		loadDisabled: readDisabledPackagedModuleIds,
		readEnabled: readOptionalPackagedModuleEnabled,
		setEnabled: writePackagedModuleEnabled,
		subscribe(listener) {
			const onChanged = (
				changes: Record<string, chrome.storage.StorageChange>,
				areaName: string,
			): void => {
				if (areaName !== 'local') return;
				for (const [key, change] of Object.entries(changes)) {
					const id = moduleIdFromInstallationStorageKey(key);
					if (!id) continue;
					const meta = OPTIONAL_MODULES.find((module) => module.id === id);
					if (!meta) continue;
					listener(
						id,
						isPackagedModuleMetaEnabled(
							meta,
							change.newValue,
							change.newValue !== undefined,
						),
					);
				}
			};
			chrome.storage.onChanged.addListener(onChanged);
			return () => chrome.storage.onChanged.removeListener(onChanged);
		},
	};
}

export interface ModuleManagerSnapshot {
	revision: number;
	installedModules: readonly ModuleMeta[];
	availableModules: readonly ModuleMeta[];
}

const EMPTY_SNAPSHOT: ModuleManagerSnapshot = Object.freeze({
	revision: 0,
	installedModules: Object.freeze([]) as readonly ModuleMeta[],
	availableModules: Object.freeze([]) as readonly ModuleMeta[],
});

export class ModuleManager {
	private readonly disabled = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private readonly mutationTailById = new Map<string, Promise<void>>();
	private readonly hydrationEventOwnedIds = new Set<string>();
	private revision = 0;
	private snapshot: ModuleManagerSnapshot = EMPTY_SNAPSHOT;
	private unsubscribePersistence: (() => void) | null = null;
	private hydrating = false;

	constructor(
		private readonly persistence: ModuleInstallationPersistence = createChromePersistence(),
	) {}

	async initialize(): Promise<void> {
		if (this.unsubscribePersistence) return;
		this.hydrating = true;
		this.unsubscribePersistence = this.persistence.subscribe((id, enabled) => {
			if (this.hydrating) this.hydrationEventOwnedIds.add(id);
			this.applyEnabled(id, enabled);
		});
		try {
			const disabledFromStorage = await this.persistence.loadDisabled();
			for (const module of OPTIONAL_MODULES) {
				if (this.hydrationEventOwnedIds.has(module.id)) continue;
				if (disabledFromStorage.has(module.id)) this.disabled.add(module.id);
				else this.disabled.delete(module.id);
			}
			this.refreshSnapshot();
		} catch (error) {
			this.unsubscribePersistence?.();
			this.unsubscribePersistence = null;
			throw error;
		} finally {
			this.hydrating = false;
			this.hydrationEventOwnedIds.clear();
		}
	}

	dispose(): void {
		this.unsubscribePersistence?.();
		this.unsubscribePersistence = null;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getSnapshot(): ModuleManagerSnapshot { return this.snapshot; }
	getRevision(): number { return this.revision; }

	private refreshSnapshot(): void {
		this.snapshot = Object.freeze({
			revision: this.revision,
			installedModules: Object.freeze(ALL_MODULES.filter((module) => this.isInstalled(module.id))),
			availableModules: Object.freeze(OPTIONAL_MODULES.filter((module) => !this.isInstalled(module.id))),
		});
	}

	private notify(): void {
		this.revision += 1;
		this.refreshSnapshot();
		for (const listener of this.listeners) listener();
	}

	private applyEnabled(id: string, enabled: boolean): void {
		const meta = ALL_MODULES.find((module) => module.id === id);
		if (!meta || meta.builtIn) return;
		const wasEnabled = !this.disabled.has(id);
		if (wasEnabled === enabled) return;
		if (enabled) this.disabled.delete(id);
		else this.disabled.add(id);
		this.notify();
	}

	private serializeMutation(id: string, mutation: () => Promise<void>): Promise<void> {
		const previous = this.mutationTailById.get(id) ?? Promise.resolve();
		const operation = previous.catch(() => undefined).then(mutation);
		const tracked = operation.finally(() => {
			if (this.mutationTailById.get(id) === tracked) this.mutationTailById.delete(id);
		});
		this.mutationTailById.set(id, tracked);
		return tracked;
	}

	getState(id: string): ModuleState | undefined {
		const meta = ALL_MODULES.find((module) => module.id === id);
		if (!meta) return undefined;
		return this.isInstalled(id)
			? { id, status: 'installed', installedVersion: meta.version }
			: { id, status: 'available' };
	}

	getAllStates(): ModuleState[] {
		return ALL_MODULES.map((module) => this.getState(module.id) as ModuleState);
	}

	isInstalled(id: string): boolean {
		const meta = ALL_MODULES.find((module) => module.id === id);
		return Boolean(meta && (meta.builtIn || !this.disabled.has(id)));
	}

	getInstalledModules(): ModuleMeta[] { return [...this.snapshot.installedModules]; }
	getAvailableModules(): ModuleMeta[] { return [...this.snapshot.availableModules]; }

	install(id: string): Promise<void> {
		return this.serializeMutation(id, async () => {
			const meta = ALL_MODULES.find((module) => module.id === id);
			if (!meta) throw new Error(`Module ${id} not found`);
			if (meta.builtIn || this.isInstalled(id)) return;
			await this.persistence.setEnabled(id, true);
			this.applyEnabled(id, await this.persistence.readEnabled(id));
		});
	}

	uninstall(id: string): Promise<void> {
		return this.serializeMutation(id, async () => {
			const meta = ALL_MODULES.find((module) => module.id === id);
			if (!meta || meta.builtIn) throw new Error(`Cannot uninstall: ${id}`);
			if (!this.isInstalled(id)) return;
			await this.persistence.setEnabled(id, false);
			this.applyEnabled(id, await this.persistence.readEnabled(id));
		});
	}
}

let instance: ModuleManager | null = null;
let initPromise: Promise<ModuleManager> | null = null;
export const getModuleManager = async (): Promise<ModuleManager> => {
	if (instance) return instance;
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const manager = new ModuleManager();
		await manager.initialize();
		instance = manager;
		initPromise = null;
		return manager;
	})();
	initPromise.catch(() => { initPromise = null; });
	return initPromise;
};
