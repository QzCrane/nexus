import { describe, expect, test } from 'bun:test';
import type { HaloSettings } from '../src/kernel/core/settings';
import {
	CORE_MODULES,
	OPTIONAL_MODULES,
	type ModuleState,
} from '../src/kernel/registry/module-registry';
import {
	createMissingCoreModuleStates,
	ModuleManager,
	type ModuleStatePersistence,
} from '../src/kernel/managers/module-manager';
import { resolveCategoryOrder } from '../src/components/sidepanel/hooks/use-categorized-tools';

function createMemoryPersistence(initial: ModuleState[] = []) {
	const stored = new Map(initial.map((state) => [state.id, { ...state }]));
	let saveFailureId: string | null = null;
	let removeFailureId: string | null = null;
	const persistence: ModuleStatePersistence = {
		loadAll: async () => [...stored.values()].map((state) => ({ ...state })),
		save: async (state) => {
			if (state.id === saveFailureId) throw new Error(`save failed: ${state.id}`);
			stored.set(state.id, { ...state });
		},
		remove: async (id) => {
			if (id === removeFailureId) throw new Error(`remove failed: ${id}`);
			stored.delete(id);
		},
		shouldPersistSeed: () => true,
	};
	return {
		persistence,
		stored,
		failSaveFor: (id: string | null) => { saveFailureId = id; },
		failRemoveFor: (id: string | null) => { removeFailureId = id; },
	};
}

describe('HALO module lifecycle authority', () => {
	test('seeds only core modules and leaves optional modules available on a fresh profile', async () => {
		expect(CORE_MODULES.length).toBeGreaterThan(0);
		expect(OPTIONAL_MODULES.length).toBeGreaterThan(0);

		const missing = createMissingCoreModuleStates(new Set(), 123);
		expect(new Set(missing.map((state) => state.id))).toEqual(
			new Set(CORE_MODULES.map((module) => module.id)),
		);
		expect(missing.every((state) => state.installedAt === 123)).toBe(true);
		expect(missing.some((state) => OPTIONAL_MODULES.some((module) => module.id === state.id))).toBe(false);

		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();

		for (const module of CORE_MODULES) expect(manager.isInstalled(module.id)).toBe(true);
		for (const module of OPTIONAL_MODULES) expect(manager.isInstalled(module.id)).toBe(false);
		expect(new Set(manager.getAvailableModules().map((module) => module.id))).toEqual(
			new Set(OPTIONAL_MODULES.map((module) => module.id)),
		);
	});

	test('persists install/uninstall truth, emits monotonic revisions, and keeps uninstall across restart', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires at least one optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const revisions: number[] = [];
		const unsubscribe = manager.subscribe(() => revisions.push(manager.getRevision()));

		expect(manager.getRevision()).toBe(0);
		await manager.install(optional.id);
		expect(manager.isInstalled(optional.id)).toBe(true);
		expect(memory.stored.get(optional.id)?.status).toBe('installed');
		expect(revisions).toEqual([1]);

		await manager.install(optional.id);
		expect(revisions).toEqual([1]);

		await manager.uninstall(optional.id);
		expect(manager.isInstalled(optional.id)).toBe(false);
		expect(memory.stored.has(optional.id)).toBe(false);
		expect(revisions).toEqual([1, 2]);
		unsubscribe();

		const restarted = new ModuleManager(memory.persistence);
		await restarted.initialize();
		expect(restarted.isInstalled(optional.id)).toBe(false);
		expect(restarted.getAvailableModules().some((module) => module.id === optional.id)).toBe(true);
	});

	test('rolls back in-memory authority when install, update, or uninstall persistence fails', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires at least one optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();

		memory.failSaveFor(optional.id);
		await expect(manager.install(optional.id)).rejects.toThrow(`save failed: ${optional.id}`);
		expect(manager.isInstalled(optional.id)).toBe(false);
		expect(manager.getRevision()).toBe(0);

		memory.failSaveFor(null);
		await manager.install(optional.id);
		expect(manager.isInstalled(optional.id)).toBe(true);
		expect(manager.getRevision()).toBe(1);

		memory.failSaveFor(optional.id);
		await expect(manager.update(optional.id)).rejects.toThrow(`save failed: ${optional.id}`);
		expect(manager.getState(optional.id)?.status).toBe('installed');
		expect(manager.getRevision()).toBe(1);

		memory.failSaveFor(null);
		memory.failRemoveFor(optional.id);
		await expect(manager.uninstall(optional.id)).rejects.toThrow(`remove failed: ${optional.id}`);
		expect(manager.isInstalled(optional.id)).toBe(true);
		expect(manager.getRevision()).toBe(1);
	});
});

describe('HALO category projection', () => {
	test('canonicalizes stale saved order without mutating settings during render', () => {
		const persistedOrder = ['dev', 'encode', 'dev', 'removed-category'];
		const settings = {
			categoryOrder: persistedOrder,
			showSystemTools: true,
		} as HaloSettings;
		const before = [...persistedOrder];

		const result = resolveCategoryOrder(settings, null);
		expect(persistedOrder).toEqual(before);
		expect(result).not.toBe(persistedOrder);
		expect(result[0]).toBe('active');
		expect(result).toContain('scripts');
		expect(result).toContain('system');
		expect(result).not.toContain('removed-category');
		expect(result.filter((id) => id === 'dev')).toHaveLength(1);
		expect(new Set(result).size).toBe(result.length);
	});

	test('returns an isolated temporary drag order and removes hidden system category', () => {
		const temporary = ['scripts', 'active', 'dev'];
		const projectedTemporary = resolveCategoryOrder(null, temporary);
		expect(projectedTemporary).toEqual(temporary);
		expect(projectedTemporary).not.toBe(temporary);

		const settings = {
			categoryOrder: ['active', 'scripts', 'system', 'dev'],
			showSystemTools: false,
		} as HaloSettings;
		expect(resolveCategoryOrder(settings, null)).not.toContain('system');
	});
});
