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

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

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

	test('two manager instances serialize the complete same-module write transaction in one realm', async () => {
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');
		let physicalEnabled = true;
		const firstWriteStarted = deferred();
		const releaseFirstWrite = deferred();
		const writes: boolean[] = [];
		let writeCount = 0;
		const persistence: ModuleInstallationPersistence = {
			loadDisabled: async () => new Set(),
			readEnabled: async () => physicalEnabled,
			setEnabled: async (_id, enabled) => {
				writeCount += 1;
				writes.push(enabled);
				if (writeCount === 1) {
					firstWriteStarted.resolve();
					await releaseFirstWrite.promise;
				}
				physicalEnabled = enabled;
			},
			subscribe: () => () => undefined,
		};
		const first = new ModuleManager(persistence);
		const second = new ModuleManager(persistence);
		await Promise.all([first.initialize(), second.initialize()]);
		const uninstall = first.uninstall(optional.id);
		await firstWriteStarted.promise;
		const install = second.install(optional.id);
		await Promise.resolve();
		expect(writes).toEqual([false]);
		releaseFirstWrite.resolve();
		await Promise.all([uninstall, install]);
		expect(writes).toEqual([false, true]);
		expect(physicalEnabled).toBe(true);
	});

	test('source uses Web Locks across extension contexts and fails closed if production loses that primitive', () => {
		const source = readFileSync(new URL('../src/kernel/managers/module-manager.ts', import.meta.url), 'utf8');
		expect(source).toContain('navigator.locks');
		expect(source).toContain('MODULE_MUTATION_LOCK_PREFIX');
		expect(source).toContain('runCrossContextMutation(id, mutation)');
		expect(source).toContain("Boolean(chrome.runtime?.id)");
		expect(source).toContain("throw new Error('Web Locks unavailable for packaged-module mutation authority')");
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
		expect(resolveDesiredRegisteredScripts(
			scriptState([packaged]),
			scriptState([saat]),
			true,
			moduleValues,
		)).toEqual([]);
	});

	test('rejects ambiguous ownership markers before runtime registration', () => {
		const legacyAmbiguous = script('legacy', { saatToolId: 'legacy' });
		expect(() => userScriptsRegistryTestApi.validateOwnershipContainers(
			[legacyAmbiguous],
			[],
		)).toThrow('Invalid packaged-script ownership metadata');
		expect(() => userScriptsRegistryTestApi.validateOwnershipContainers(
			[],
			[script('bad-saat', {
				saatToolId: 'bad-saat',
				managedBy: 'packaged-script',
				moduleBuiltIn: false,
			})],
		)).toThrow('Invalid SaaT ownership metadata');
	});
});

describe('persistent UserScripts recovery contract', () => {
	const registrySource = readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8');

	test('prepares the complete next registration generation before destructive teardown', () => {
		const prepareIndex = registrySource.indexOf('const prepared = prepareRegistration(desired);');
		const unregisterIndex = registrySource.indexOf('await unregisterAllScripts();', prepareIndex);
		expect(prepareIndex).toBeGreaterThanOrEqual(0);
		expect(unregisterIndex).toBeGreaterThan(prepareIndex);
		expect(() => userScriptsRegistryTestApi.toMatchPatterns([])).toThrow('At least one match pattern is required');
		expect(() => userScriptsRegistryTestApi.toMatchPatterns(['   '])).toThrow('Empty match pattern');
	});

	test('uses a durable dirty/clean digest receipt instead of a race-prone boolean clear', () => {
		expect(userScriptsRegistryTestApi.RECEIPT_VERSION).toBe(2);
		expect(registrySource).toContain("state: 'dirty'");
		expect(registrySource).toContain("state: 'clean'");
		expect(registrySource).toContain('digestAuthority');
		expect(registrySource).toContain('writeRecoveryReceipt(digest)');
		expect(registrySource).toContain('isMatchingReceipt');
		expect(registrySource).not.toContain('clearRecoveryNeeded');
		expect(userScriptsRegistryTestApi.SYNC_RETRY_DELAYS_MS).toEqual([250, 1_000, 4_000]);
	});

	test('canonical receipt encoding preserves key order and distinguishes undefined from strings', () => {
		const { canonicalize } = userScriptsRegistryTestApi;
		expect(canonicalize(undefined)).toBe('undefined');
		expect(canonicalize('undefined')).toBe('"undefined"');
		expect(canonicalize({ b: 1, a: undefined })).toBe('{"a":undefined,"b":1}');
		expect(canonicalize({ b: 1, a: undefined })).toBe(canonicalize({ a: undefined, b: 1 }));
		expect(() => canonicalize(Symbol('unsupported'))).toThrow('Unsupported registry authority value');
	});

	test('startup recovery compares the persisted receipt to current physical authority', () => {
		expect(registrySource).toContain('readRegistryAuthority()');
		expect(registrySource).toContain('!isMatchingReceipt(receiptResult[RECOVERY_STORAGE_KEY], authority.digest)');
		expect(registrySource).toContain("requestRegisteredScriptSync('worker-startup-recovery')");
		expect(registrySource).not.toContain('!userscriptsModuleEnabled ||');
	});
});

test('optional system active panels must obey installation rather than taxonomy', () => {
	const source = readFileSync(new URL('../src/components/sidepanel/hooks/use-open-tools.ts', import.meta.url), 'utf8');
	expect(source).toContain('current === null || isInstalled(current) ? current : null');
	expect(source).toContain('isKnownTool(savedActive) && isInstalled(savedActive)');
	expect(source).not.toContain('isSystemTool(current) || isInstalled(current)');
});

test('Launcher custom scripts require healthy UserScripts module authority and exclude packaged records', () => {
	const source = readFileSync(new URL('../src/kernel/hooks/use-user-scripts.ts', import.meta.url), 'utf8');
	expect(source).toContain("module.id === 'userscripts'");
	expect(source).toContain('!degraded');
	expect(source).toContain('value.saatToolId === undefined');
	expect(source).toContain('value.managedBy === undefined');
	expect(source).toContain('if (!enabled)');
});
