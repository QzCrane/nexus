import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

const openToolsSource = readFileSync(
	new URL('../src/components/sidepanel/hooks/use-open-tools.ts', import.meta.url),
	'utf8',
);
const moduleListSource = readFileSync(
	new URL('../src/system/module-store/module-list.tsx', import.meta.url),
	'utf8',
);

function createMemoryPersistence(initial: ModuleState[] = []) {
	const stored = new Map(initial.map((state) => [state.id, { ...state }]));
	let saveFailureId: string | null = null;
	let removeFailureId: string | null = null;
	let seedBatchCount = 0;
	const persistence: ModuleStatePersistence = {
		loadAll: async () => [...stored.values()].map((state) => ({ ...state })),
		save: async (state) => {
			if (state.id === saveFailureId) throw new Error(`save failed: ${state.id}`);
			stored.set(state.id, { ...state });
		},
		saveMany: async (states) => {
			seedBatchCount += 1;
			const failed = states.find((state) => state.id === saveFailureId);
			if (failed) throw new Error(`save failed: ${failed.id}`);
			for (const state of states) stored.set(state.id, { ...state });
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
		getSeedBatchCount: () => seedBatchCount,
		failSaveFor: (id: string | null) => { saveFailureId = id; },
		failRemoveFor: (id: string | null) => { removeFailureId = id; },
	};
}

describe('HALO module lifecycle authority', () => {
	test('seeds only core modules in one batch and leaves optional modules available', async () => {
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

		expect(memory.getSeedBatchCount()).toBe(1);
		for (const module of CORE_MODULES) expect(manager.isInstalled(module.id)).toBe(true);
		for (const module of OPTIONAL_MODULES) expect(manager.isInstalled(module.id)).toBe(false);
		expect(new Set(manager.getAvailableModules().map((module) => module.id))).toEqual(
			new Set(OPTIONAL_MODULES.map((module) => module.id)),
		);

		const restarted = new ModuleManager(memory.persistence);
		await restarted.initialize();
		expect(memory.getSeedBatchCount()).toBe(1);
	});

	test('rolls back every implicit core state when the one seed batch fails', async () => {
		const core = CORE_MODULES[0];
		if (!core) throw new Error('HALO test requires at least one core module');
		const memory = createMemoryPersistence();
		memory.failSaveFor(core.id);
		const manager = new ModuleManager(memory.persistence);

		await expect(manager.initialize()).rejects.toThrow(`save failed: ${core.id}`);
		expect(manager.getAllStates()).toEqual([]);
		expect(manager.getRevision()).toBe(0);
		expect(manager.getSnapshot().installedModules).toEqual([]);
		expect(memory.stored.size).toBe(0);
	});

	test('publishes one immutable snapshot identity per durable revision', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires at least one optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();

		const initial = manager.getSnapshot();
		expect(manager.getSnapshot()).toBe(initial);
		expect(initial.revision).toBe(0);
		expect(Object.isFrozen(initial)).toBe(true);
		expect(Object.isFrozen(initial.installedModules)).toBe(true);
		expect(Object.isFrozen(initial.availableModules)).toBe(true);

		await manager.install(optional.id);
		const installed = manager.getSnapshot();
		expect(installed).not.toBe(initial);
		expect(installed.revision).toBe(1);
		expect(installed.installedModules.some((module) => module.id === optional.id)).toBe(true);
		expect(manager.getSnapshot()).toBe(installed);
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

		const staleMemory = createMemoryPersistence([{
			id: optional.id,
			status: 'installed',
			installedVersion: '0.0.0-stale',
			installedAt: 1,
		}]);
		const updatingManager = new ModuleManager(staleMemory.persistence);
		await updatingManager.initialize();
		const beforeFailedUpdate = updatingManager.getSnapshot();
		staleMemory.failSaveFor(optional.id);
		await expect(updatingManager.update(optional.id)).rejects.toThrow(`save failed: ${optional.id}`);
		expect(updatingManager.getState(optional.id)).toMatchObject({
			status: 'installed',
			installedVersion: '0.0.0-stale',
		});
		expect(updatingManager.getSnapshot()).toBe(beforeFailedUpdate);
		expect(updatingManager.getRevision()).toBe(0);

		memory.failRemoveFor(optional.id);
		await expect(manager.uninstall(optional.id)).rejects.toThrow(`remove failed: ${optional.id}`);
		expect(manager.isInstalled(optional.id)).toBe(true);
		expect(manager.getRevision()).toBe(1);
	});

	test('retires stale async open-tool hydration instead of replaying it over live authority', () => {
		expect(openToolsSource).toContain('const authorityEpoch = useRef(0);');
		expect(openToolsSource).toContain('if (epoch !== authorityEpoch.current || initialized.current) return;');
		expect(openToolsSource).toContain('if (initialized.current) {');
		expect(openToolsSource).toContain('reconcileInstalledTools(isInstalled);');
		expect(openToolsSource).not.toMatch(/setTimeout\([^)]*initialized/u);
	});

	test('uses builtIn itself as the Module Store uninstallability authority', () => {
		expect(moduleListSource).toContain('isCore={mod.builtIn === true}');
		expect(moduleListSource).not.toContain("mod.builtIn && mod.pluginType === 'tool'");
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
