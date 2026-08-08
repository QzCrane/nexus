import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	ModuleManager,
	type ModuleInstallationPersistence,
} from '../src/kernel/managers/module-manager';
import { moduleInstallationStorageKey } from '../src/kernel/core/module-installation-runtime';
import { OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';
import {
	resolveDesiredRegisteredScripts,
	userScriptsRegistryTestApi,
} from '../src/system/userscripts/registry';
import type { UserScript, UserScriptState } from '../src/system/userscripts/types';

function createDivergentPersistence(initialManagerDisabled: boolean) {
	const optional = OPTIONAL_MODULES[0];
	if (!optional) throw new Error('HALO test requires an optional module');
	let physicalEnabled = !initialManagerDisabled;
	const writes: boolean[] = [];
	const persistence: ModuleInstallationPersistence = {
		loadDisabled: async () => initialManagerDisabled ? new Set([optional.id]) : new Set(),
		readEnabled: async () => physicalEnabled,
		setEnabled: async (_id, enabled) => {
			writes.push(enabled);
			physicalEnabled = enabled;
		},
		subscribe: () => () => undefined,
	};
	return {
		optional,
		persistence,
		writes,
		setPhysicalEnabled(enabled: boolean) { physicalEnabled = enabled; },
		physicalEnabled: () => physicalEnabled,
	};
}

function script(id: string, overrides: Partial<UserScript> = {}): UserScript {
	return {
		id,
		name: id,
		description: '',
		code: '',
		enabled: true,
		type: 'javascript',
		matches: ['*://*/*'],
		runAt: 'document_idle',
		order: 0,
		runCount: 0,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function scriptState(scripts: UserScript[], globalEnabled = true): UserScriptState {
	return { scripts, globalEnabled };
}

describe('cross-context packaged-module mutations', () => {
	test('install persists even when this manager still looks installed', async () => {
		const state = createDivergentPersistence(false);
		const manager = new ModuleManager(state.persistence);
		await manager.initialize();
		expect(manager.isInstalled(state.optional.id)).toBe(true);
		state.setPhysicalEnabled(false);
		await manager.install(state.optional.id);
		expect(state.writes).toEqual([true]);
		expect(state.physicalEnabled()).toBe(true);
		expect(manager.isInstalled(state.optional.id)).toBe(true);
	});

	test('uninstall persists even when this manager still looks uninstalled', async () => {
		const state = createDivergentPersistence(true);
		const manager = new ModuleManager(state.persistence);
		await manager.initialize();
		expect(manager.isInstalled(state.optional.id)).toBe(false);
		state.setPhysicalEnabled(true);
		await manager.uninstall(state.optional.id);
		expect(state.writes).toEqual([false]);
		expect(state.physicalEnabled()).toBe(false);
		expect(manager.isInstalled(state.optional.id)).toBe(false);
	});
});

describe('script runtime ownership', () => {
	test('UserScripts module tombstone disables custom scripts but not built-in packaged scripts', () => {
		const custom = script('custom');
		const builtInPackaged = script('bilibili-plus', {
			saatToolId: 'bilibili-plus',
			managedBy: 'packaged-script',
			moduleBuiltIn: true,
		});
		const desired = resolveDesiredRegisteredScripts(
			scriptState([custom, builtInPackaged]),
			scriptState([]),
			false,
			{},
		);
		expect(desired.map((item) => item.id)).toEqual(['bilibili-plus']);
	});

	test('optional packaged scripts and SaaT tools obey their own module tombstones', () => {
		const packaged = script('optional-packaged', {
			saatToolId: 'optional-packaged',
			managedBy: 'packaged-script',
			moduleBuiltIn: false,
		});
		const saat = script('saat-runtime', {
			saatToolId: 'totp',
			managedBy: 'saat-tool',
			moduleBuiltIn: false,
		});
		const moduleValues = {
			[moduleInstallationStorageKey('optional-packaged')]: false,
			[moduleInstallationStorageKey('totp')]: false,
		};
		const desired = resolveDesiredRegisteredScripts(
			scriptState([packaged]),
			scriptState([saat]),
			true,
			moduleValues,
		);
		expect(desired).toEqual([]);
	});

	test('container global switches remain content settings independent of module installation', () => {
		const packaged = script('packaged', {
			saatToolId: 'packaged',
			managedBy: 'packaged-script',
			moduleBuiltIn: true,
		});
		const saat = script('saat', {
			saatToolId: 'hash',
			managedBy: 'saat-tool',
			moduleBuiltIn: true,
		});
		expect(resolveDesiredRegisteredScripts(
			scriptState([packaged], false),
			scriptState([saat], true),
			true,
			{},
		).map((item) => item.id)).toEqual(['saat']);
	});
});

describe('persistent UserScripts recovery contract', () => {
	const registrySource = readFileSync(
		new URL('../src/system/userscripts/registry.ts', import.meta.url),
		'utf8',
	);

	test('propagates unregister/register failures and refuses implicit all-URL fallback', () => {
		expect(registrySource).toContain("throw new Error(failures.join('; '))");
		expect(registrySource).toContain('await unregisterAllScripts();');
		expect(() => userScriptsRegistryTestApi.toMatchPatterns([])).toThrow(
			'At least one match pattern is required',
		);
		expect(() => userScriptsRegistryTestApi.toMatchPatterns(['   '])).toThrow('Empty match pattern');
	});

	test('persists dirty authority before reconciliation and clears it only after the complete sync succeeds', () => {
		const markIndex = registrySource.indexOf('await markRecoveryNeeded();');
		const syncIndex = registrySource.indexOf('await syncRegisteredScripts();', markIndex);
		const clearIndex = registrySource.indexOf('await clearRecoveryNeeded();', syncIndex);
		expect(markIndex).toBeGreaterThanOrEqual(0);
		expect(syncIndex).toBeGreaterThan(markIndex);
		expect(clearIndex).toBeGreaterThan(syncIndex);
		expect(registrySource).toContain('RECOVERY_STORAGE_KEY');
		expect(userScriptsRegistryTestApi.SYNC_RETRY_DELAYS_MS).toEqual([250, 1_000, 4_000]);
	});

	test('recovers on worker startup only when module/dirty state requires it', () => {
		expect(registrySource).toContain('recoverPersistentRegistryIfNeeded();');
		expect(registrySource).toContain("requestRegisteredScriptSync('worker-startup-recovery')");
		expect(registrySource).toContain('result[RECOVERY_STORAGE_KEY] === true');
		expect(registrySource).not.toContain("requestRegisteredScriptSync('worker-startup');");
	});
});

test('optional system active panels must obey installation rather than taxonomy', () => {
	const source = readFileSync(
		new URL('../src/components/sidepanel/hooks/use-open-tools.ts', import.meta.url),
		'utf8',
	);
	expect(source).toContain('current === null || isInstalled(current) ? current : null');
	expect(source).toContain('isKnownTool(savedActive) && isInstalled(savedActive)');
	expect(source).not.toContain('isSystemTool(current) || isInstalled(current)');
});

test('Launcher custom scripts are bound to the UserScripts module and exclude packaged records', () => {
	const source = readFileSync(
		new URL('../src/kernel/hooks/use-user-scripts.ts', import.meta.url),
		'utf8',
	);
	expect(source).toContain("module.id === 'userscripts'");
	expect(source).toContain('value.saatToolId === undefined');
	expect(source).toContain('value.managedBy === undefined');
	expect(source).toContain('if (!enabled)');
});
