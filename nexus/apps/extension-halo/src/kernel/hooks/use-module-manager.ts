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

const EMPTY_MODULE_SNAPSHOT: ModuleManagerSnapshot = Object.freeze({
	revision: 0,
	installedModules: Object.freeze([]) as readonly ModuleMeta[],
	availableModules: Object.freeze([]) as readonly ModuleMeta[],
});

interface UseModuleManagerResult {
	loading: boolean;
	installedModules: readonly ModuleMeta[];
	availableModules: readonly ModuleMeta[];
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

	// ModuleManager publishes one immutable snapshot identity per durable
	// authority revision. Ordinary React renders therefore reuse the exact same
	// installed/available arrays instead of manufacturing false change signals.
	const subscribe = useCallback((listener: () => void) => (
		manager ? manager.subscribe(listener) : () => {}
	), [manager]);
	const getSnapshot = useCallback(
		() => manager?.getSnapshot() ?? EMPTY_MODULE_SNAPSHOT,
		[manager],
	);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

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
		const meta = ALL_MODULES.find((module) => module.id === id);
		return meta?.builtIn === true;
	}, []);

	return {
		loading,
		installedModules: snapshot.installedModules,
		availableModules: snapshot.availableModules,
		getStatus,
		install,
		uninstall,
		isInstalled,
		isCore,
	};
};
