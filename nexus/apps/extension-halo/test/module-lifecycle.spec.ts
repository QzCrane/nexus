import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { HaloSettings } from '../src/kernel/core/settings';
import { ALL_MODULES, CORE_MODULES, OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';
import { ModuleManager, type ModuleEnablementPersistence } from '../src/kernel/managers/module-manager';
import {
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../src/kernel/core/module-installation-runtime';
import { resolveCategoryOrder } from '../src/components/sidepanel/hooks/use-categorized-tools';

const openToolsSource = readFileSync(new URL('../src/components/sidepanel/hooks/use-open-tools.ts', import.meta.url), 'utf8');
const moduleListSource = readFileSync(new URL('../src/system/module-store/module-list.tsx', import.meta.url), 'utf8');
const modulePanelSource = readFileSync(new URL('../src/system/module-store/panel.tsx', import.meta.url), 'utf8');
const smoothScrollSource = readFileSync(new URL('../src/content/smooth-scroll.ts', import.meta.url), 'utf8');
const userscriptsRegistrySource = readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8');
const userscriptsEngineSource = readFileSync(new URL('../src/system/userscripts/engine.ts', import.meta.url), 'utf8');
const deadlineCoordinatorSource = readFileSync(new URL('../src/kernel/core/deadline-jobs/coordinator.ts', import.meta.url), 'utf8');

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function createMemoryPersistence(initialDisabled: readonly string[] = []) {
	const disabled = new Set(initialDisabled);
	const listeners = new Set<(id: string, enabled: boolean) => void>();
	const writes: Array<{ id: string; enabled: boolean }> = [];
	let failureId: string | null = null;
	let gateFactory: ((id: string, enabled: boolean) => Promise<void>) | null = null;
	let readOverride: ((id: string, current: boolean) => boolean) | null = null;
	const persistence: ModuleEnablementPersistence = {
		loadDisabled: async () => new Set(disabled),
		readEnabled: async (id) => {
			const current = !disabled.has(id);
			return readOverride ? readOverride(id, current) : current;
		},
		async setEnabled(id, enabled) {
			writes.push({ id, enabled });
			if (gateFactory) await gateFactory(id, enabled);
			if (failureId === id) throw new Error(`write failed: ${id}`);
			if (enabled) disabled.delete(id);
			else disabled.add(id);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		persistence,
		disabled,
		writes,
		failFor(id: string | null) { failureId = id; },
		setGate(factory: ((id: string, enabled: boolean) => Promise<void>) | null) { gateFactory = factory; },
		setReadOverride(factory: ((id: string, current: boolean) => boolean) | null) { readOverride = factory; },
		emit(id: string, enabled: boolean) {
			if (enabled) disabled.delete(id);
			else disabled.add(id);
			for (const listener of listeners) listener(id, enabled);
		},
	};
}

describe('HALO packaged-module lifecycle authority', () => {
	test('fresh packaged modules are installed by default without persistence seed writes', async () => {
		expect(CORE_MODULES.length).toBeGreaterThan(0);
		expect(OPTIONAL_MODULES.length).toBeGreaterThan(0);
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		expect(manager.getSnapshot().degraded).toBe(false);
		expect(memory.writes).toEqual([]);
		expect(manager.getDisabledModules()).toEqual([]);
		expect(new Set(manager.getEnabledModules().map((module) => module.id))).toEqual(
			new Set(ALL_MODULES.map((module) => module.id)),
		);
	});

	test('false tombstone persists disable across restart and enable removes it', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		await manager.disable(optional.id);
		expect(memory.disabled.has(optional.id)).toBe(true);
		expect(manager.getState(optional.id)?.status).toBe('disabled');
		const restarted = new ModuleManager(memory.persistence);
		await restarted.initialize();
		expect(restarted.isEnabled(optional.id)).toBe(false);
		await restarted.enable(optional.id);
		expect(memory.disabled.has(optional.id)).toBe(false);
		expect(restarted.isEnabled(optional.id)).toBe(true);
	});

	test('built-in modules remain installed and cannot be disabled', async () => {
		const core = CORE_MODULES[0];
		if (!core) throw new Error('HALO test requires a built-in module');
		const memory = createMemoryPersistence([core.id]);
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		expect(manager.isEnabled(core.id)).toBe(true);
		await expect(manager.disable(core.id)).rejects.toThrow(`Cannot disable: ${core.id}`);
		expect(memory.writes).toEqual([]);
	});

	test('storage hydration failure keeps built-ins visible, fails optional modules closed, and can retry', async () => {
		let failing = true;
		const disabled = new Set<string>();
		const persistence: ModuleEnablementPersistence = {
			loadDisabled: async () => {
				if (failing) throw new Error('storage unavailable');
				return new Set(disabled);
			},
			readEnabled: async (id) => !disabled.has(id),
			setEnabled: async () => undefined,
			subscribe: () => () => undefined,
		};
		const originalError = console.error;
		console.error = () => undefined;
		try {
			const manager = new ModuleManager(persistence);
			await manager.initialize();
			expect(manager.getSnapshot().degraded).toBe(true);
			expect(new Set(manager.getEnabledModules().map((module) => module.id))).toEqual(
				new Set(CORE_MODULES.map((module) => module.id)),
			);
			expect(manager.getDisabledModules()).toHaveLength(OPTIONAL_MODULES.length);
			failing = false;
			expect(await manager.retryEnablementState()).toBe(true);
			expect(manager.getSnapshot().degraded).toBe(false);
			expect(manager.getEnabledModules()).toHaveLength(ALL_MODULES.length);
		} finally {
			console.error = originalError;
		}
	});

	test('snapshot identity changes only when effective authority changes', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const initial = manager.getSnapshot();
		await manager.enable(optional.id);
		expect(manager.getSnapshot()).toBe(initial);
		await manager.disable(optional.id);
		const disabled = manager.getSnapshot();
		expect(disabled).not.toBe(initial);
		expect(disabled.revision).toBe(1);
	});

	test('failed persistence never publishes a module transition', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const initial = manager.getSnapshot();
		memory.failFor(optional.id);
		await expect(manager.disable(optional.id)).rejects.toThrow(`write failed: ${optional.id}`);
		expect(manager.getSnapshot()).toBe(initial);
	});

	test('serializes disable then enable only after the first physical write has started', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const firstWriteStarted = deferred();
		const releaseFirstWrite = deferred();
		let writeCount = 0;
		const memory = createMemoryPersistence();
		memory.setGate(async () => {
			writeCount += 1;
			if (writeCount === 1) {
				firstWriteStarted.resolve();
				await releaseFirstWrite.promise;
			}
		});
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const first = manager.disable(optional.id);
		await firstWriteStarted.promise;
		const second = manager.enable(optional.id);
		expect(memory.writes).toEqual([{ id: optional.id, enabled: false }]);
		releaseFirstWrite.resolve();
		await Promise.all([first, second]);
		expect(memory.writes).toEqual([
			{ id: optional.id, enabled: false },
			{ id: optional.id, enabled: true },
		]);
	});

	test('serializes enable then disable from a tombstone after the first write starts', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const firstWriteStarted = deferred();
		const releaseFirstWrite = deferred();
		let writeCount = 0;
		const memory = createMemoryPersistence([optional.id]);
		memory.setGate(async () => {
			writeCount += 1;
			if (writeCount === 1) {
				firstWriteStarted.resolve();
				await releaseFirstWrite.promise;
			}
		});
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const first = manager.enable(optional.id);
		await firstWriteStarted.promise;
		const second = manager.disable(optional.id);
		expect(memory.writes).toEqual([{ id: optional.id, enabled: true }]);
		releaseFirstWrite.resolve();
		await Promise.all([first, second]);
		expect(memory.writes).toEqual([
			{ id: optional.id, enabled: true },
			{ id: optional.id, enabled: false },
		]);
	});

	test('commits the post-write physical value instead of the local requested value', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		memory.setReadOverride((_id, current) => current ? current : true);
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		await manager.disable(optional.id);
		expect(manager.isEnabled(optional.id)).toBe(true);
	});

	test('live storage events converge an initialized manager', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		memory.emit(optional.id, false);
		expect(manager.isEnabled(optional.id)).toBe(false);
		memory.emit(optional.id, true);
		expect(manager.isEnabled(optional.id)).toBe(true);
	});

	test('retires stale async open-tool hydration instead of replaying it over live authority', () => {
		expect(openToolsSource).toContain('const authorityEpoch = useRef(0);');
		expect(openToolsSource).toContain('if (epoch !== authorityEpoch.current || initialized.current) return;');
		expect(openToolsSource).toContain('reconcileEnabledTools(isEnabled);');
	});
});

describe('HALO packaged-module runtime contract', () => {
	test('missing optional state is installed; corrupt explicit state fails closed', () => {
		expect(isOptionalPackagedModuleStoredEnabled(undefined, false)).toBe(true);
		expect(isOptionalPackagedModuleStoredEnabled(false, true)).toBe(false);
		expect(isOptionalPackagedModuleStoredEnabled(true, true)).toBe(true);
		expect(isOptionalPackagedModuleStoredEnabled('corrupt', true)).toBe(false);
		expect(moduleInstallationStorageKey('smooth-scroll')).toContain('smooth-scroll');
	});

	test('persistent optional runtimes consume the same installation authority', () => {
		expect(smoothScrollSource).toContain('readOptionalPackagedModuleEnabled(MODULE_ID)');
		expect(smoothScrollSource).toContain('runtimeEnabled()');
		expect(userscriptsRegistrySource).toContain("moduleInstallationStorageKey('userscripts')");
		expect(userscriptsRegistrySource).toContain('resolveDesiredRegisteredScripts');
		expect(userscriptsRegistrySource).toContain('includesModuleInstallationChange');
		expect(userscriptsEngineSource).toContain('requireInstalledModule()');
		expect(deadlineCoordinatorSource).toContain("readOptionalPackagedModuleEnabled(POMODORO_MODULE_ID)");
		expect(deadlineCoordinatorSource).toContain("changes[POMODORO_MODULE_STORAGE_KEY]");
		expect(deadlineCoordinatorSource).not.toContain('module-manager');
	});

	test('builtIn is the sole packaged-module uninstallability authority', () => {
		expect(moduleListSource).toContain('isCore={mod.builtIn === true}');
		expect(modulePanelSource).toContain('if (module.builtIn)');
		expect(modulePanelSource).not.toContain("if (m.pluginType === 'system')");
	});
});

describe('HALO category projection', () => {
	test('canonicalizes stale saved order without mutating settings during render', () => {
		const persistedOrder = ['dev', 'encode', 'dev', 'removed-category'];
		const settings = { categoryOrder: persistedOrder, showSystemTools: true } as HaloSettings;
		const before = [...persistedOrder];
		const result = resolveCategoryOrder(settings, null);
		expect(persistedOrder).toEqual(before);
		expect(result).not.toBe(persistedOrder);
		expect(result[0]).toBe('active');
		expect(result).toContain('scripts');
		expect(result).toContain('system');
		expect(result).not.toContain('removed-category');
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
