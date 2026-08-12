// goal: React hook for module manager
// eff: Reactive module state access in components

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
	type ModuleManager,
	type ModuleManagerSnapshot,
	getModuleManager,
} from '../managers/module-manager';
import { ALL_MODULES, type ModuleStatus } from '../registry/module-registry';
import type { ModuleMeta } from '../core/tool-registry-types';

const BUILTIN_MODULES = Object.freeze(ALL_MODULES.filter((module) => module.builtIn));
const FALLBACK_MODULE_SNAPSHOT: ModuleManagerSnapshot = Object.freeze({
	revision: 0,
	degraded: true,
	installedModules: BUILTIN_MODULES,
	availableModules: Object.freeze([]) as readonly ModuleMeta[],
});

interface UseModuleManagerResult {
	loading: boolean;
	degraded: boolean;
	installedModules: readonly ModuleMeta[];
	availableModules: readonly ModuleMeta[];
	getStatus: (id: string) => ModuleStatus;
	install: (id: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	retry: () => Promise<boolean>;
	isInstalled: (id: string) => boolean;
	isCore: (id: string) => boolean;
}

function isBuiltIn(id: string): boolean {
	return ALL_MODULES.find((module) => module.id === id)?.builtIn === true;
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

	const subscribe = useCallback((listener: () => void) => (
		manager ? manager.subscribe(listener) : () => {}
	), [manager]);
	const getSnapshot = useCallback(
		() => manager?.getSnapshot() ?? FALLBACK_MODULE_SNAPSHOT,
		[manager],
	);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const getStatus = useCallback((id: string): ModuleStatus => {
		if (!manager) return isBuiltIn(id) ? 'installed' : 'available';
		return manager.getState(id)?.status ?? 'available';
	}, [manager]);

	const install = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.install(id);
	}, [manager]);

	const uninstall = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.uninstall(id);
	}, [manager]);

	const retry = useCallback(async (): Promise<boolean> => (
		manager ? manager.retryInstallationState() : false
	), [manager]);

	const isInstalled = useCallback((id: string): boolean => (
		manager ? manager.isInstalled(id) : isBuiltIn(id)
	), [manager]);

	const isCore = useCallback((id: string): boolean => isBuiltIn(id), []);

	return {
		loading,
		degraded: snapshot.degraded,
		installedModules: snapshot.installedModules,
		availableModules: snapshot.availableModules,
		getStatus,
		install,
		uninstall,
		retry,
		isInstalled,
		isCore,
	};
};
