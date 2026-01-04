import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ExtensionInfo, ExtensionGroup } from '../types';
import { getAllExtensions, loadGroups, assignToGroup, enableExtension, disableExtension } from '../core';
import type { FilterType } from '../components/ExtensionFilter';

export function useExtensionManager() {
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);
	const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
	const [groups, setGroups] = useState<Record<ExtensionGroup, string[]>>({ dev: [], work: [], entertainment: [], other: [] });
	const [filter, setFilter] = useState<FilterType>('all');
	const [search, setSearch] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		chrome.permissions.contains({ permissions: ['management'] }, (granted) => {
			setHasPermission(granted);
			if (granted) setLoading(true);
			else setLoading(false);
		});
	}, []);

	const loadData = useCallback(async () => {
		if (!hasPermission) return;
		setLoading(true);
		const [exts, grps] = await Promise.all([getAllExtensions(), loadGroups()]);
		setExtensions(exts);
		setGroups(grps);
		setLoading(false);
	}, [hasPermission]);

	useEffect(() => {
		if (hasPermission) loadData();
	}, [loadData, hasPermission]);

	useEffect(() => {
		if (!hasPermission) return;
		const listener = () => loadData();
		chrome.management?.onEnabled?.addListener(listener);
		chrome.management?.onDisabled?.addListener(listener);
		chrome.management?.onInstalled?.addListener(listener);
		chrome.management?.onUninstalled?.addListener(listener);
		return () => {
			chrome.management?.onEnabled?.removeListener(listener);
			chrome.management?.onDisabled?.removeListener(listener);
			chrome.management?.onInstalled?.removeListener(listener);
			chrome.management?.onUninstalled?.removeListener(listener);
		};
	}, [loadData, hasPermission]);

	const requestAccess = async () => {
		const granted = await chrome.permissions.request({ permissions: ['management'] });
		setHasPermission(granted);
		if (granted) loadData();
	};

	const getExtGroup = useCallback((id: string): ExtensionGroup | undefined => {
		for (const [g, ids] of Object.entries(groups)) {
			if (ids.includes(id)) return g as ExtensionGroup;
		}
		return undefined;
	}, [groups]);

	const filtered = useMemo(() => {
		let result = extensions;
		if (search) {
			const q = search.toLowerCase();
			result = result.filter(e => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
		}
		if (filter === 'enabled') result = result.filter(e => e.enabled);
		else if (filter === 'disabled') result = result.filter(e => !e.enabled);
		else if (filter === 'none') {
			const allGroupedIds = Object.values(groups).flat();
			result = result.filter(e => !allGroupedIds.includes(e.id));
		}
		else if (['dev', 'work', 'entertainment', 'other'].includes(filter)) {
			result = result.filter(e => groups[filter as ExtensionGroup].includes(e.id));
		}
		return result.sort((a, b) => a.name.localeCompare(b.name));
	}, [extensions, search, filter, groups]);

	const handleAssignGroup = useCallback(async (extId: string, group: ExtensionGroup | '') => {
		const newGroups = await assignToGroup(extId, group, groups);
		setGroups(newGroups);
	}, [groups]);

	const disabledCount = useMemo(() => filtered.filter(e => !e.enabled && e.mayDisable).length, [filtered]);
	const enabledCount = useMemo(() => filtered.filter(e => e.enabled && e.mayDisable).length, [filtered]);

	return {
		hasPermission,
		loading,
		search,
		setSearch,
		filter,
		setFilter,
		filtered,
		disabledCount,
		enabledCount,
		loadData,
		requestAccess,
		getExtGroup,
		handleAssignGroup
	};
}
