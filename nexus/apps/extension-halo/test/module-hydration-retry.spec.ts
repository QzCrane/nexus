import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	ModuleManager,
	type ModuleInstallationPersistence,
} from '../src/kernel/managers/module-manager';
import { ALL_MODULES, CORE_MODULES, OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';

function failingThenHealthyPersistence(): {
	persistence: ModuleInstallationPersistence;
	recover(): void;
} {
	let failing = true;
	const persistence: ModuleInstallationPersistence = {
		loadDisabled: async () => {
			if (failing) throw new Error('storage unavailable');
			return new Set();
		},
		readEnabled: async () => true,
		setEnabled: async () => undefined,
		subscribe: () => () => undefined,
	};
	return { persistence, recover: () => { failing = false; } };
}

describe('module hydration retry publication', () => {
	test('publishes one external-store revision when degraded authority recovers', async () => {
		const state = failingThenHealthyPersistence();
		const manager = new ModuleManager(state.persistence);
		const originalError = console.error;
		console.error = () => undefined;
		try {
			await manager.initialize();
			const degraded = manager.getSnapshot();
			expect(degraded.degraded).toBe(true);
			expect(degraded.installedModules.map((module) => module.id)).toEqual(
				CORE_MODULES.map((module) => module.id),
			);
			expect(degraded.availableModules).toHaveLength(OPTIONAL_MODULES.length);

			let notifications = 0;
			const unsubscribe = manager.subscribe(() => { notifications += 1; });
			state.recover();
			expect(await manager.retryInstallationState()).toBe(true);
			const recovered = manager.getSnapshot();
			expect(recovered).not.toBe(degraded);
			expect(recovered.degraded).toBe(false);
			expect(recovered.revision).toBe(degraded.revision + 1);
			expect(recovered.installedModules).toHaveLength(ALL_MODULES.length);
			expect(notifications).toBe(1);
			unsubscribe();
		} finally {
			console.error = originalError;
		}
	});

	test('does not publish a false revision when a healthy retry changes no authority', async () => {
		const persistence: ModuleInstallationPersistence = {
			loadDisabled: async () => new Set(),
			readEnabled: async () => true,
			setEnabled: async () => undefined,
			subscribe: () => () => undefined,
		};
		const manager = new ModuleManager(persistence);
		await manager.initialize();
		const initial = manager.getSnapshot();
		let notifications = 0;
		const unsubscribe = manager.subscribe(() => { notifications += 1; });
		expect(await manager.retryInstallationState()).toBe(true);
		expect(manager.getSnapshot()).toBe(initial);
		expect(notifications).toBe(0);
		unsubscribe();
	});

	test('fails every optional projection closed when a previously healthy authority degrades', async () => {
		let failing = false;
		const persistence: ModuleInstallationPersistence = {
			loadDisabled: async () => {
				if (failing) throw new Error('storage unavailable');
				return new Set();
			},
			readEnabled: async () => true,
			setEnabled: async () => undefined,
			subscribe: () => () => undefined,
		};
		const manager = new ModuleManager(persistence);
		await manager.initialize();
		expect(manager.getSnapshot().installedModules).toHaveLength(ALL_MODULES.length);
		const optional = OPTIONAL_MODULES[0];
		if (!optional) throw new Error('HALO test requires an optional module');

		let notifications = 0;
		const unsubscribe = manager.subscribe(() => { notifications += 1; });
		const originalError = console.error;
		console.error = () => undefined;
		try {
			failing = true;
			expect(await manager.retryInstallationState()).toBe(false);
			const degraded = manager.getSnapshot();
			expect(degraded.degraded).toBe(true);
			expect(degraded.installedModules.map((module) => module.id)).toEqual(
				CORE_MODULES.map((module) => module.id),
			);
			expect(degraded.availableModules).toHaveLength(OPTIONAL_MODULES.length);
			expect(manager.isInstalled(optional.id)).toBe(false);
			expect(manager.getState(optional.id)?.status).toBe('available');
			expect(notifications).toBe(1);

			failing = false;
			expect(await manager.retryInstallationState()).toBe(true);
			expect(manager.getSnapshot().degraded).toBe(false);
			expect(manager.getSnapshot().installedModules).toHaveLength(ALL_MODULES.length);
			expect(manager.isInstalled(optional.id)).toBe(true);
			expect(notifications).toBe(2);
		} finally {
			console.error = originalError;
			unsubscribe();
		}
	});
});

test('kernel script-runtime ownership vocabulary has no system-layer dependency', () => {
	const serviceSource = readFileSync(
		new URL('../src/kernel/services/saat-service.ts', import.meta.url),
		'utf8',
	);
	const coreOwnershipSource = readFileSync(
		new URL('../src/kernel/core/script-runtime-ownership.ts', import.meta.url),
		'utf8',
	);
	expect(coreOwnershipSource).toContain("'packaged-script' | 'saat-tool'");
	expect(serviceSource).not.toContain('../../system/userscripts/types');
	expect(serviceSource).toContain('script-runtime-ownership');
});
