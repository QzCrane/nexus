// goal: React hook for module manager
// eff: Reactive module state access in components

import { useState, useEffect, useCallback } from 'react';
import { ModuleManager, getModuleManager } from '../managers/module-manager';
import { ALL_MODULES, OPTIONAL_MODULES, type ModuleState, type ModuleStatus } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';

interface UseModuleManagerResult {
	loading: boolean;
	installedModules: ModuleMeta[];
	availableModules: ModuleMeta[];
	getStatus: (id: string) => ModuleStatus;
	install: (id: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	isInstalled: (id: string) => boolean;
	isCore: (id: string) => boolean;
}

export const useModuleManager = (): UseModuleManagerResult => {
	const [manager, setManager] = useState<ModuleManager | null>(null);
	const [loading, setLoading] = useState(true);
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		let cancelled = false;
		// rule: capture the unsubscribe handle on a closure variable so the effect's
		// cleanup function can invoke it. The previous `return unsub` was the resolved
		// value of the promise callback, not the useEffect cleanup — so the listener
		// was never removed and accumulated across every mount/unmount cycle, leaking
		// memory and forcing stale-state updates on unmounted components.
		let unsubscribe: (() => void) | null = null;

		getModuleManager().then((m) => {
			if (cancelled) return;
			setManager(m);
			setLoading(false);

			// Subscribe to changes
			unsubscribe = m.subscribe(() => forceUpdate((n) => n + 1));
		});

		return () => {
			cancelled = true;
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = null;
			}
		};
	}, []);

	const getStatus = useCallback((id: string): ModuleStatus => {
		if (!manager) return 'available';
		const state = manager.getState(id);
		return state?.status || 'available';
	}, [manager]);

	const install = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.install(id);
	}, [manager]);

	const uninstall = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.uninstall(id);
	}, [manager]);

	const isInstalled = useCallback((id: string): boolean => {
		if (!manager) return false;
		return manager.isInstalled(id);
	}, [manager]);

	const isCore = useCallback((id: string): boolean => {
		const meta = ALL_MODULES.find((m) => m.id === id);
		return meta?.builtIn === true;
	}, []);

	const installedModules = manager?.getInstalledModules() || [];
	const availableModules = manager?.getAvailableModules() || [];

	return { loading, installedModules, availableModules, getStatus, install, uninstall, isInstalled, isCore };
};
