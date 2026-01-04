// goal: React hook for tool installation manager
// eff: Reactive tool install state access in components

import { useState, useEffect, useCallback } from 'react';
import { ToolInstallManager, getToolInstallManager } from '../managers/tool-install-manager';
import { ALL_TOOLS, type ToolInstallStatus } from '../registry/tool-registry';
import type { ToolMeta } from '../core/tool-registry-types';

interface UseToolInstallResult {
	loading: boolean;
	installedTools: ToolMeta[];
	availableTools: ToolMeta[];
	getStatus: (id: string) => ToolInstallStatus;
	install: (id: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	isInstalled: (id: string) => boolean;
	isCore: (id: string) => boolean;
}

export const useToolInstall = (): UseToolInstallResult => {
	const [manager, setManager] = useState<ToolInstallManager | null>(null);
	const [loading, setLoading] = useState(true);
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		let cancelled = false;
		getToolInstallManager().then((m) => {
			if (cancelled) return;
			setManager(m);
			setLoading(false);

			// Subscribe to changes
			const unsub = m.subscribe(() => forceUpdate((n) => n + 1));
			return unsub;
		});

		return () => { cancelled = true; };
	}, []);

	const getStatus = useCallback((id: string): ToolInstallStatus => {
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
		const meta = ALL_TOOLS.find((m) => m.id === id);
		return meta?.builtIn === true;
	}, []);

	const installedTools = manager?.getInstalledTools() || [];
	const availableTools = manager?.getAvailableTools() || [];

	return { loading, installedTools, availableTools, getStatus, install, uninstall, isInstalled, isCore };
};
