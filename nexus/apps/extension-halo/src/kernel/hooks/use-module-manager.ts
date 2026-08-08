// goal: React hook for module manager
// eff: Reactive module state access in components

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { type ModuleManager, getModuleManager } from '../managers/module-manager';
import { ALL_MODULES, type ModuleStatus } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';

interface UseModuleManagerResult {
	loading: boolean;
	revision: number;
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

	useEffect(() => {
		let cancelled = false;
		void getModuleManager().then((nextManager) => {
			if (cancelled) return;
			setManager(nextManager);
			setLoading(false);
		}).catch((error: unknown) => {
			if (!cancelled) setLoading(false);
			console.error('useModuleManager: getModuleManager failed', error);
		});
		return () => { cancelled = true; };
	}, []);

	// ModuleManager is an external mutable authority. useSyncExternalStore gives
	// React a monotonic snapshot instead of relying on an unrelated forceUpdate
	// whose callback identities stayed stable and could leave downstream memos stale.
	const subscribe = useCallback((listener: () => void) => (
		manager ? manager.subscribe(listener) : () => {}
	), [manager]);
	const getSnapshot = useCallback(() => manager?.getRevision() ?? 0, [manager]);
	const revision = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

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

	const installedModules = useMemo(
		() => manager?.getInstalledModules() ?? [],
		[manager, revision],
	);
	const availableModules = useMemo(
		() => manager?.getAvailableModules() ?? [],
		[manager, revision],
	);

	return {
		loading,
		revision,
		installedModules,
		availableModules,
		getStatus,
		install,
		uninstall,
		isInstalled,
		isCore,
	};
};
