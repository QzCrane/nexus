import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	ModuleManager,
	type ModuleInstallationPersistence,
} from '../src/kernel/managers/module-manager';
import { moduleInstallationStorageKey } from '../src/kernel/core/module-installation-runtime';
import { OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';
import { isUserScriptsCapabilityAvailable } from '../src/system/userscripts/capability';
import {
	resolveDesiredRegisteredScripts,
	userScriptsRegistryTestApi,
} from '../src/system/userscripts/registry';
import type { UserScript, UserScriptState } from '../src/system/userscripts/types';
import {
	deleteUserScript,
	toggleUserScript,
	updateUserScript,
} from '../src/system/userscripts/operations';

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
	test('managed scripts reject direct user mutation at the storage owner', async () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		const managed = script('packaged', {
			managedBy: 'packaged-script',
			saatToolId: 'packaged',
			moduleBuiltIn: true,
		});
		let stored = scriptState([managed]);
		try {
			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { storage: { local: {
					get: async () => ({ halo_userscripts: structuredClone(stored) }),
					set: async (value: Record<string, UserScriptState>) => { stored = structuredClone(value.halo_userscripts); },
				} } },
			});
			await expect(updateUserScript(managed.id, { name: 'tampered' })).rejects.toThrow('Managed script');
			await expect(toggleUserScript(managed.id)).rejects.toThrow('Managed script');
			await expect(deleteUserScript(managed.id)).rejects.toThrow('Managed script');
			expect(stored.scripts[0]?.name).toBe('packaged');
			expect(stored.scripts).toHaveLength(1);
		} finally {
			if (previous) Object.defineProperty(globalThis, 'chrome', previous);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

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

	test('preserves an explicit MAIN execution world instead of silently downgrading it', () => {
		const prepared = userScriptsRegistryTestApi.prepareRegistration([
			script('main-world', { world: 'MAIN' }),
		]);
		expect(prepared.userScripts).toHaveLength(1);
		expect(prepared.userScripts[0]?.world).toBe('MAIN');
	});

	test('rejects duplicate enabled runtime ids before any browser registration teardown', () => {
		expect(() => userScriptsRegistryTestApi.prepareRegistration([
			script('duplicate'),
			script('duplicate', { managedBy: 'saat-tool', saatToolId: 'totp', moduleBuiltIn: false }),
		])).toThrow('Duplicate runtime script id: duplicate');
	});
});

describe('persistent UserScripts recovery contract', () => {
	const registrySource = readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8');

	test('prepares the complete next registration generation before non-destructive reconciliation', () => {
		const prepareIndex = registrySource.indexOf('const prepared = prepareRegistration(desired);');
		const reconcileIndex = registrySource.indexOf('await reconcilePrepared(', prepareIndex);
		expect(prepareIndex).toBeGreaterThanOrEqual(0);
		expect(reconcileIndex).toBeGreaterThan(prepareIndex);
		expect(registrySource).toContain('await chrome.userScripts.register(additions)');
		expect(registrySource).toContain('await chrome.userScripts.update(updates)');
		expect(registrySource.indexOf('await chrome.userScripts.unregister')).toBeGreaterThan(
			registrySource.indexOf('await chrome.userScripts.update'),
		);
		expect(() => userScriptsRegistryTestApi.toMatchPatterns([])).toThrow('At least one match pattern is required');
		expect(() => userScriptsRegistryTestApi.toMatchPatterns(['   '])).toThrow('Empty match pattern');
	});

	test('uses durable dirty/blocked/clean digest receipts instead of a race-prone boolean clear', () => {
		expect(userScriptsRegistryTestApi.RECEIPT_VERSION).toBe(2);
		expect(registrySource).toContain("state: 'dirty'");
		expect(registrySource).toContain("state: 'blocked' | 'clean'");
		expect(registrySource).toContain('digestAuthority');
		expect(registrySource).toContain('writeRecoveryReceipt(result.digest, result.receiptState)');
		expect(registrySource).toContain('isSatisfiedReceipt');
		expect(registrySource).not.toContain('clearRecoveryNeeded');
		expect(userScriptsRegistryTestApi.SYNC_RETRY_DELAYS_MS).toEqual([250, 1_000, 4_000]);
	});

	test('receipt satisfaction distinguishes platform-blocked from fully clean authority', () => {
		const { isSatisfiedReceipt } = userScriptsRegistryTestApi;
		const clean = { version: 2, state: 'clean', digest: 'abc' };
		const blocked = { version: 2, state: 'blocked', digest: 'abc' };
		const dirty = { version: 2, state: 'dirty' };
		expect(isSatisfiedReceipt(clean, 'abc', true)).toBe(true);
		expect(isSatisfiedReceipt(blocked, 'abc', true)).toBe(false);
		expect(isSatisfiedReceipt(blocked, 'abc', false)).toBe(true);
		expect(isSatisfiedReceipt(clean, 'abc', false)).toBe(false);
		expect(isSatisfiedReceipt(dirty, 'abc', false)).toBe(false);
		expect(isSatisfiedReceipt(blocked, 'different', false)).toBe(false);
	});

	test('canonical receipt encoding preserves key order and distinguishes undefined from strings', () => {
		const { canonicalize } = userScriptsRegistryTestApi;
		expect(canonicalize(undefined)).toBe('undefined');
		expect(canonicalize('undefined')).toBe('"undefined"');
		expect(canonicalize({ b: 1, a: undefined })).toBe('{"a":undefined,"b":1}');
		expect(canonicalize({ b: 1, a: undefined })).toBe(canonicalize({ a: undefined, b: 1 }));
		expect(() => canonicalize(Symbol('unsupported'))).toThrow('Unsupported registry authority value');
	});

	test('runtime capability probe treats namespace absence and method rejection as unavailable', async () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
		try {
			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { userScripts: undefined },
			});
			expect(await isUserScriptsCapabilityAvailable()).toBe(false);

			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { userScripts: { getScripts: async () => { throw new Error('toggle disabled'); } } },
			});
			expect(await isUserScriptsCapabilityAvailable()).toBe(false);

			Object.defineProperty(globalThis, 'chrome', {
				configurable: true,
				value: { userScripts: { getScripts: async () => [] } },
			});
			expect(await isUserScriptsCapabilityAvailable()).toBe(true);
		} finally {
			if (previous) Object.defineProperty(globalThis, 'chrome', previous);
			else Reflect.deleteProperty(globalThis, 'chrome');
		}
	});

	test('startup recovery includes platform capability and blocked state in physical receipt authority', () => {
		expect(registrySource).toContain('isUserScriptsCapabilityAvailable()');
		expect(registrySource).toContain('userScriptsAvailable,');
		expect(registrySource).toContain('hasSatisfiedPersistentRegistryReceipt');
		expect(registrySource).toContain("requestRegisteredScriptSync('worker-startup-recovery')");
		expect(registrySource).not.toContain('!userscriptsModuleEnabled ||');
	});

	test('explicit readiness checks are idempotent and preserve a satisfied browser registry', () => {
		const ensureIndex = registrySource.indexOf('export function ensureRegisteredScriptsSynchronized');
		const satisfiedIndex = registrySource.indexOf('let satisfied = await hasSatisfiedPersistentRegistryReceipt();', ensureIndex);
		const guardIndex = registrySource.indexOf('if (!satisfied) {', satisfiedIndex);
		const syncIndex = registrySource.indexOf('await syncRegisteredScripts();', ensureIndex);
		const verifyIndex = registrySource.indexOf('satisfied = await hasSatisfiedPersistentRegistryReceipt();', syncIndex);
		expect(ensureIndex).toBeGreaterThanOrEqual(0);
		expect(satisfiedIndex).toBeGreaterThan(ensureIndex);
		expect(guardIndex).toBeGreaterThan(satisfiedIndex);
		expect(syncIndex).toBeGreaterThan(guardIndex);
		expect(verifyIndex).toBeGreaterThan(syncIndex);
		expect(registrySource).toContain('if (reconciliation) await reconciliation;');
		expect(registrySource).toContain('if (ensureSynchronized) return ensureSynchronized;');
	});

	test('runtime readiness ACK requires available capability plus a matching clean receipt', () => {
		const runtimeReadyIndex = registrySource.indexOf('export function ensureUserScriptsRuntimeReady');
		const availabilityIndex = registrySource.indexOf('if (!status.userScriptsAvailable)', runtimeReadyIndex);
		const satisfiedIndex = registrySource.indexOf('if (status.satisfied) return;', runtimeReadyIndex);
		expect(runtimeReadyIndex).toBeGreaterThanOrEqual(0);
		expect(availabilityIndex).toBeGreaterThan(runtimeReadyIndex);
		expect(satisfiedIndex).toBeGreaterThan(availabilityIndex);
		expect(registrySource).toContain('for (let attempt = 0; attempt < 2; attempt += 1)');
		expect(registrySource).toContain('readPersistentRegistryReceiptStatus');
		expect(registrySource).toContain('Chrome User Scripts runtime capability is unavailable');
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
	expect(source).toContain('useUserScriptsStorageSnapshot');
	expect(source).toContain('script.saatToolId !== undefined');
	expect(source).toContain('script.managedBy !== undefined');
	expect(source).toContain('snapshot.failed');
});

test('UserScripts panel readiness waits for Background registry ACK and fences stale refreshes', () => {
	const source = readFileSync(new URL('../src/system/userscripts/hooks/useUserScripts.ts', import.meta.url), 'utf8');
	const syncIndex = source.indexOf('await ensureBackgroundRegistryReady();');
	const readyIndex = source.indexOf('setHasPermission(true);', syncIndex);
	expect(source).toContain('isUserScriptsCapabilityAvailable');
	expect(source).toContain('hasHosts && hasUserScripts');
	expect(source).toContain('isSuccessfulRegistrySyncResponse');
	expect(source).toContain('readinessSyncRef');
	expect(source).toContain('statusRevisionRef');
	expect(source).toContain("type: 'HALO_USERSCRIPTS_SYNC'");
	expect(source).toContain('registrySyncFailed');
	expect(source).toContain('allowUserScriptsRequired');
	expect(syncIndex).toBeGreaterThanOrEqual(0);
	expect(readyIndex).toBeGreaterThan(syncIndex);
	expect(source).not.toContain('becameAvailable');
	expect(source).not.toContain("void chrome.runtime.sendMessage({ type: 'HALO_USERSCRIPTS_SYNC' }");
});

test('Background UserScripts sync message ACKs only after clean available runtime readiness', () => {
	const source = readFileSync(new URL('../src/system/userscripts/engine.ts', import.meta.url), 'utf8');
	expect(source).toContain('ensureUserScriptsRuntimeReady');
	expect(source).toContain("message.type === 'HALO_USERSCRIPTS_SYNC'");
	expect(source).toContain('then(() => sendResponse({ success: true }))');
	expect(source).not.toContain('void syncRegisteredScripts()');
	expect(source).not.toContain('void ensureRegisteredScriptsSynchronized()');
});
