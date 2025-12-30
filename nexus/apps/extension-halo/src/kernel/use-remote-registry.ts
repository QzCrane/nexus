// goal: React hook for remote registry
// eff: Check updates + manage remote module sources

import { useState, useEffect, useCallback } from 'react';
import { fetchRemoteRegistry, checkForUpdates, type RemoteRegistry, type ModuleUpdate } from './remote-registry';

interface UseRemoteRegistryResult {
	loading: boolean;
	registry: RemoteRegistry | null;
	updates: ModuleUpdate[];
	hasUpdates: boolean;
	refresh: () => Promise<void>;
	lastChecked: number | null;
}

export const useRemoteRegistry = (): UseRemoteRegistryResult => {
	const [loading, setLoading] = useState(false);
	const [registry, setRegistry] = useState<RemoteRegistry | null>(null);
	const [updates, setUpdates] = useState<ModuleUpdate[]>([]);
	const [lastChecked, setLastChecked] = useState<number | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const [reg, upd] = await Promise.all([
				fetchRemoteRegistry(true),
				checkForUpdates(),
			]);
			setRegistry(reg);
			setUpdates(upd);
			setLastChecked(Date.now());
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial load (from cache)
	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			const reg = await fetchRemoteRegistry(false);
			if (cancelled) return;
			setRegistry(reg);
			if (reg) setLastChecked(Date.now());
		};
		load();
		return () => { cancelled = true; };
	}, []);

	return { loading, registry, updates, hasUpdates: updates.length > 0, refresh, lastChecked };
};
