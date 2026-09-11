// goal: packaged-module enable/disable authority
// eff: one chrome.storage.local tombstone per optional module; bundled code never leaves the package

import { ALL_MODULES, OPTIONAL_MODULES, type ModuleState } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';
import { isReleaseAdmittedPlugin } from '../registry/_generated-release-admission';
import { readOptionalPackagedModuleEnabled } from '../core/module-installation-runtime';
import {
	isPackagedModuleMetaEnabled,
	moduleIdFromInstallationStorageKey,
	readDisabledPackagedModuleIds,
	writePackagedModuleEnabled,
} from './module-installation-store';

export interface ModuleEnablementPersistence {
	loadDisabled(): Promise<Set<string>>;
	readEnabled(id: string): Promise<boolean>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
	subscribe(listener: (id: string, enabled: boolean) => void): () => void;
}

function createChromePersistence(): ModuleEnablementPersistence {
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
	degraded: boolean;
	enabledModules: readonly ModuleMeta[];
	disabledModules: readonly ModuleMeta[];
}

const BUILTIN_MODULES = Object.freeze(ALL_MODULES.filter((module) => module.builtIn && isReleaseAdmittedPlugin(module.id)));
const INITIAL_SNAPSHOT: ModuleManagerSnapshot = Object.freeze({
	revision: 0,
	degraded: true,
	enabledModules: BUILTIN_MODULES,
	disabledModules: Object.freeze([]) as readonly ModuleMeta[],
});
const REALM_MUTATION_TAIL_BY_ID = new Map<string, Promise<void>>();
const MODULE_MUTATION_LOCK_PREFIX = 'halo-module-installation-v2:';

function serializeRealmMutation(id: string, mutation: () => Promise<void>): Promise<void> {
	const previous = REALM_MUTATION_TAIL_BY_ID.get(id) ?? Promise.resolve();
	const operation = previous.catch(() => undefined).then(mutation);
	const tracked = operation.finally(() => {
		if (REALM_MUTATION_TAIL_BY_ID.get(id) === tracked) REALM_MUTATION_TAIL_BY_ID.delete(id);
	});
	REALM_MUTATION_TAIL_BY_ID.set(id, tracked);
	return tracked;
}

async function runCrossContextMutation(id: string, mutation: () => Promise<void>): Promise<void> {
	const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!lockManager) {
		// Tests and non-browser consumers may not expose the Web platform lock
		// surface. A real extension context must never silently downgrade to
		// realm-only serialization because that would reintroduce lost intent
		// across SidePanel/worker/other extension contexts.
		const extensionRuntime = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
		if (extensionRuntime) throw new Error('Web Locks unavailable for packaged-module mutation authority');
		await mutation();
		return;
	}
	await lockManager.request(`${MODULE_MUTATION_LOCK_PREFIX}${id}`, async () => {
		await mutation();
	});
}

export class ModuleManager {
	private readonly disabled = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private readonly hydrationEventOwnedIds = new Set<string>();
	private revision = 0;
	private degraded = true;
	private snapshot: ModuleManagerSnapshot = INITIAL_SNAPSHOT;
	private unsubscribePersistence: (() => void) | null = null;
	private hydrating = false;

	constructor(
		private readonly persistence: ModuleEnablementPersistence = createChromePersistence(),
	) {
		for (const module of OPTIONAL_MODULES) this.disabled.add(module.id);
	}

	private async loadDisabledWithRetry(): Promise<Set<string>> {
		try {
			return await this.persistence.loadDisabled();
		} catch (firstError) {
			try {
				return await this.persistence.loadDisabled();
			} catch {
				throw firstError;
			}
		}
	}

	private applyHydratedDisabled(disabledFromStorage: ReadonlySet<string>): boolean {
		let changed = false;
		for (const module of OPTIONAL_MODULES) {
			if (this.hydrationEventOwnedIds.has(module.id)) continue;
			const shouldDisable = disabledFromStorage.has(module.id);
			const wasDisabled = this.disabled.has(module.id);
			if (shouldDisable) this.disabled.add(module.id);
			else this.disabled.delete(module.id);
			if (wasDisabled !== shouldDisable) changed = true;
		}
		return changed;
	}

	private commitHydration(degraded: boolean, changed: boolean, publish: boolean): void {
		const degradedChanged = this.degraded !== degraded;
		this.degraded = degraded;
		if (publish) {
			if (changed || degradedChanged) this.notify();
			return;
		}
		// Initialization must always materialize the first complete snapshot. A
		// healthy no-op retry, by contrast, must preserve snapshot identity.
		this.refreshSnapshot();
	}

	async initialize(): Promise<void> {
		if (this.unsubscribePersistence) return;
		this.hydrating = true;
		this.unsubscribePersistence = this.persistence.subscribe((id, enabled) => {
			if (this.hydrating) this.hydrationEventOwnedIds.add(id);
			this.applyEnabled(id, enabled);
		});
		try {
			const disabledFromStorage = await this.loadDisabledWithRetry();
			const changed = this.applyHydratedDisabled(disabledFromStorage);
			this.commitHydration(false, changed, false);
		} catch (error) {
			let changed = false;
			for (const module of OPTIONAL_MODULES) {
				if (this.hydrationEventOwnedIds.has(module.id)) continue;
				if (!this.disabled.has(module.id)) changed = true;
				this.disabled.add(module.id);
			}
			this.commitHydration(true, changed, false);
			console.error('[HALO:ModuleManager] Enablement hydration failed', error);
		} finally {
			this.hydrating = false;
			this.hydrationEventOwnedIds.clear();
		}
	}

	async retryEnablementState(): Promise<boolean> {
		this.hydrating = true;
		try {
			const disabledFromStorage = await this.persistence.loadDisabled();
			const changed = this.applyHydratedDisabled(disabledFromStorage);
			this.commitHydration(false, changed, true);
			return true;
		} catch (error) {
			this.commitHydration(true, false, true);
			console.error('[HALO:ModuleManager] Enablement retry failed', error);
			return false;
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
			degraded: this.degraded,
			enabledModules: Object.freeze(ALL_MODULES.filter((module) => this.isEnabled(module.id))),
			disabledModules: Object.freeze(OPTIONAL_MODULES.filter((module) => !this.isEnabled(module.id))),
		});
	}

	private notify(): void {
		this.revision += 1;
		this.refreshSnapshot();
		for (const listener of [...this.listeners]) listener();
	}

	private applyEnabled(id: string, enabled: boolean): void {
		const meta = ALL_MODULES.find((module) => module.id === id);
		if (!meta || meta.builtIn) return;
		const wasEnabled = !this.disabled.has(id);
		if (wasEnabled === enabled) return;
		if (enabled) this.disabled.delete(id);
		else this.disabled.add(id);
		// Degraded means the complete optional-module authority is unknown. Keep
		// absorbing physical events into the private cache, but do not publish an
		// optional module as enabled until a complete hydration succeeds.
		if (!this.degraded) this.notify();
	}

	private serializeMutation(id: string, mutation: () => Promise<void>): Promise<void> {
		// One realm-local tail avoids duplicate lock requests inside a context; Web
		// Locks serializes the complete write+reread transaction across extension
		// pages/workers that share the extension origin.
		return serializeRealmMutation(id, () => runCrossContextMutation(id, mutation));
	}

	getState(id: string): ModuleState | undefined {
		const meta = ALL_MODULES.find((module) => module.id === id);
		if (!meta) return undefined;
		return this.isEnabled(id)
			? { id, status: 'enabled', enabledVersion: meta.version }
			: { id, status: 'disabled' };
	}

	getAllStates(): ModuleState[] {
		return ALL_MODULES.map((module) => this.getState(module.id) as ModuleState);
	}

	isEnabled(id: string): boolean {
		const meta = ALL_MODULES.find((module) => module.id === id);
		return Boolean(meta && isReleaseAdmittedPlugin(id) && (meta.builtIn || !this.degraded && !this.disabled.has(id)));
	}

	getEnabledModules(): ModuleMeta[] { return [...this.snapshot.enabledModules]; }
	getDisabledModules(): ModuleMeta[] { return [...this.snapshot.disabledModules]; }

	enable(id: string): Promise<void> {
		return this.serializeMutation(id, async () => {
			const meta = ALL_MODULES.find((module) => module.id === id);
			if (!meta) throw new Error(`Module ${id} not found`);
			if (!isReleaseAdmittedPlugin(id)) throw new Error(`Module ${id} is not included in this release`);
			if (meta.builtIn) return;
			await this.persistence.setEnabled(id, true);
			this.applyEnabled(id, await this.persistence.readEnabled(id));
		});
	}

	disable(id: string): Promise<void> {
		return this.serializeMutation(id, async () => {
			const meta = ALL_MODULES.find((module) => module.id === id);
			if (!meta || meta.builtIn) throw new Error(`Cannot disable: ${id}`);
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
