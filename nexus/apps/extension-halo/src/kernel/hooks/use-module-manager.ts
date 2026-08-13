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
	enabledModules: BUILTIN_MODULES,
	disabledModules: Object.freeze([]) as readonly ModuleMeta[],
});

interface UseModuleManagerResult {
	loading: boolean;
	degraded: boolean;
	enabledModules: readonly ModuleMeta[];
	disabledModules: readonly ModuleMeta[];
	getStatus: (id: string) => ModuleStatus;
	enable: (id: string) => Promise<void>;
	disable: (id: string) => Promise<void>;
	retry: () => Promise<boolean>;
	isEnabled: (id: string) => boolean;
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
		if (!manager) return isBuiltIn(id) ? 'enabled' : 'disabled';
		return manager.getState(id)?.status ?? 'disabled';
	}, [manager]);

	const enable = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.enable(id);
	}, [manager]);

	const disable = useCallback(async (id: string): Promise<void> => {
		if (!manager) return;
		await manager.disable(id);
	}, [manager]);

	const retry = useCallback(async (): Promise<boolean> => (
		manager ? manager.retryEnablementState() : false
	), [manager]);

	const isEnabled = useCallback((id: string): boolean => (
		manager ? manager.isEnabled(id) : isBuiltIn(id)
	), [manager]);

	const isCore = useCallback((id: string): boolean => isBuiltIn(id), []);

	return {
		loading,
		degraded: snapshot.degraded,
		enabledModules: snapshot.enabledModules,
		disabledModules: snapshot.disabledModules,
		getStatus,
		enable,
		disable,
		retry,
		isEnabled,
		isCore,
	};
};
