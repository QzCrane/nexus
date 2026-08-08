import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	ModuleManager,
	type ModuleInstallationPersistence,
} from '../src/kernel/managers/module-manager';
import { OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';

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

describe('cross-context packaged-module mutations', () => {
	test('install persists even when this manager still looks installed', async () => {
		const state = createDivergentPersistence(false);
		const manager = new ModuleManager(state.persistence);
		await manager.initialize();
		expect(manager.isInstalled(state.optional.id)).toBe(true);

		// Another context wrote an uninstall tombstone but this manager has not yet
		// received onChanged. The user install request must still repair storage.
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

		// Another context removed the tombstone but its event is still in flight.
		state.setPhysicalEnabled(true);
		await manager.uninstall(state.optional.id);
		expect(state.writes).toEqual([false]);
		expect(state.physicalEnabled()).toBe(false);
		expect(manager.isInstalled(state.optional.id)).toBe(false);
	});
});

describe('persistent UserScripts recovery contract', () => {
	const registrySource = readFileSync(
		new URL('../src/system/userscripts/registry.ts', import.meta.url),
		'utf8',
	);

	test('propagates unregister/register failures instead of logging success', () => {
		expect(registrySource).toContain("throw new Error(failures.join('; '))");
		expect(registrySource).toContain('await unregisterAllScripts();');
		expect(registrySource).not.toContain("console.warn(LOG_TAG, 'Failed to unregister user scripts:'");
	});

	test('owns bounded retry plus persistent cross-worker recovery without normal startup churn', () => {
		expect(registrySource).toContain('SYNC_RETRY_DELAYS_MS = [250, 1_000, 4_000]');
		expect(registrySource).toContain('RECOVERY_STORAGE_KEY');
		expect(registrySource).toContain('persistRecoveryNeeded();');
		expect(registrySource).toContain('recoverPersistentRegistryIfNeeded();');
		expect(registrySource).toContain("requestRegisteredScriptSync('worker-startup-recovery')");
		expect(registrySource).toContain('if (!moduleEnabled || result[RECOVERY_STORAGE_KEY] === true)');
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
