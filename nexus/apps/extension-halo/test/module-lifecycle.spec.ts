import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { HaloSettings } from '../src/kernel/core/settings';
import {
	ALL_MODULES,
	CORE_MODULES,
	OPTIONAL_MODULES,
} from '../src/kernel/registry/module-registry';
import {
	ModuleManager,
	type ModuleInstallationPersistence,
} from '../src/kernel/managers/module-manager';
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
	const persistence: ModuleInstallationPersistence = {
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
		expect(memory.writes).toEqual([]);
		expect(manager.getAvailableModules()).toEqual([]);
		expect(new Set(manager.getInstalledModules().map((module) => module.id))).toEqual(
			new Set(ALL_MODULES.map((module) => module.id)),
		);
	});

	test('false tombstone persists uninstall across restart and install removes it', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		await manager.uninstall(optional.id);
		expect(memory.disabled.has(optional.id)).toBe(true);
		expect(manager.getState(optional.id)?.status).toBe('available');

		const restarted = new ModuleManager(memory.persistence);
		await restarted.initialize();
		expect(restarted.isInstalled(optional.id)).toBe(false);
		await restarted.install(optional.id);
		expect(memory.disabled.has(optional.id)).toBe(false);
		expect(restarted.isInstalled(optional.id)).toBe(true);
	});

	test('built-in modules remain installed and cannot be disabled', async () => {
		const core = CORE_MODULES[0];
		if (!core) throw new Error('HALO test requires a built-in module');
		const memory = createMemoryPersistence([core.id]);
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		expect(manager.isInstalled(core.id)).toBe(true);
		await expect(manager.uninstall(core.id)).rejects.toThrow(`Cannot uninstall: ${core.id}`);
		expect(memory.writes).toEqual([]);
	});

	test('snapshot identity changes only when effective authority changes', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const initial = manager.getSnapshot();
		expect(Object.isFrozen(initial)).toBe(true);
		expect(Object.isFrozen(initial.installedModules)).toBe(true);
		await manager.install(optional.id);
		expect(manager.getSnapshot()).toBe(initial);
		await manager.uninstall(optional.id);
		const disabled = manager.getSnapshot();
		expect(disabled).not.toBe(initial);
		expect(disabled.revision).toBe(1);
		await manager.uninstall(optional.id);
		expect(manager.getSnapshot()).toBe(disabled);
	});

	test('failed persistence never publishes a module transition', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const initial = manager.getSnapshot();
		memory.failFor(optional.id);
		await expect(manager.uninstall(optional.id)).rejects.toThrow(`write failed: ${optional.id}`);
		expect(manager.isInstalled(optional.id)).toBe(true);
		expect(manager.getSnapshot()).toBe(initial);
	});

	test('serializes uninstall then install for the same module', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const gate = deferred();
		let writeCount = 0;
		const memory = createMemoryPersistence();
		memory.setGate(async () => { if (++writeCount === 1) await gate.promise; });
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const first = manager.uninstall(optional.id);
		const second = manager.install(optional.id);
		expect(memory.writes).toEqual([{ id: optional.id, enabled: false }]);
		gate.resolve();
		await Promise.all([first, second]);
		expect(memory.writes).toEqual([
			{ id: optional.id, enabled: false },
			{ id: optional.id, enabled: true },
		]);
		expect(manager.isInstalled(optional.id)).toBe(true);
	});

	test('serializes install then uninstall from an existing tombstone', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const gate = deferred();
		let writeCount = 0;
		const memory = createMemoryPersistence([optional.id]);
		memory.setGate(async () => { if (++writeCount === 1) await gate.promise; });
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		const first = manager.install(optional.id);
		const second = manager.uninstall(optional.id);
		expect(memory.writes).toEqual([{ id: optional.id, enabled: true }]);
		gate.resolve();
		await Promise.all([first, second]);
		expect(memory.writes).toEqual([
			{ id: optional.id, enabled: true },
			{ id: optional.id, enabled: false },
		]);
		expect(manager.isInstalled(optional.id)).toBe(false);
	});

	test('commits the post-write physical value instead of the local requested value', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		memory.setReadOverride((_id, current) => current ? current : true);
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		await manager.uninstall(optional.id);
		expect(memory.writes).toEqual([{ id: optional.id, enabled: false }]);
		// Simulates a later external install becoming physical authority before the
		// post-write read. The manager must converge to that value, not its intent.
		expect(manager.isInstalled(optional.id)).toBe(true);
	});

	test('live storage events converge an already initialized manager', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		const memory = createMemoryPersistence();
		const manager = new ModuleManager(memory.persistence);
		await manager.initialize();
		memory.emit(optional.id, false);
		expect(manager.isInstalled(optional.id)).toBe(false);
		memory.emit(optional.id, true);
		expect(manager.isInstalled(optional.id)).toBe(true);
	});

	test('retires stale async open-tool hydration instead of replaying it over live authority', () => {
		expect(openToolsSource).toContain('const authorityEpoch = useRef(0);');
		expect(openToolsSource).toContain('if (epoch !== authorityEpoch.current || initialized.current) return;');
		expect(openToolsSource).toContain('reconcileInstalledTools(isInstalled);');
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
		expect(userscriptsRegistrySource).toContain('if (!moduleEnabled) return;');
		expect(userscriptsEngineSource).toContain('requireInstalledModule()');
	});

	test('builtIn is the sole packaged-module uninstallability authority', () => {
		expect(moduleListSource).toContain('isCore={!!mod.builtIn}');
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
