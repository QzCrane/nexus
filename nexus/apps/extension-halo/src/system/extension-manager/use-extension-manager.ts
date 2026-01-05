// goal: Extension manager state management hook
// eff: Extracted from panel.tsx for better code organization

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ExtensionInfo, ExtensionGroup } from './types';
import { getAllExtensions, loadGroups, assignToGroup, enableExtension, disableExtension } from './core';

type FilterType = 'all' | 'enabled' | 'disabled' | ExtensionGroup;

export interface UseExtensionManagerResult {
	hasPermission: boolean | null;
	extensions: ExtensionInfo[];
	groups: Record<ExtensionGroup, string[]>;
	filter: FilterType;
	setFilter: (f: FilterType) => void;
	search: string;
	setSearch: (s: string) => void;
	loading: boolean;
	filtered: ExtensionInfo[];
	loadData: () => Promise<void>;
	requestAccess: () => Promise<void>;
	getExtGroup: (id: string) => ExtensionGroup | undefined;
	handleAssignGroup: (extId: string, group: ExtensionGroup | '') => Promise<void>;
	batchEnable: (exts: ExtensionInfo[]) => Promise<void>;
	batchDisable: (exts: ExtensionInfo[]) => Promise<void>;
}

export function useExtensionManager(): UseExtensionManagerResult {
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);
	const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
	const [groups, setGroups] = useState<Record<ExtensionGroup, string[]>>({ dev: [], work: [], entertainment: [], other: [] });
	const [filter, setFilter] = useState<FilterType>('all');
	const [search, setSearch] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		chrome.permissions.contains({ permissions: ['management'] }, (granted) => {
			setHasPermission(granted);
			setLoading(!granted);
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

	// Listen for extension state changes
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

	const requestAccess = useCallback(async () => {
		const granted = await chrome.permissions.request({ permissions: ['management'] });
		setHasPermission(granted);
		if (granted) loadData();
	}, [loadData]);

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
		else if (['dev', 'work', 'entertainment', 'other'].includes(filter)) {
			result = result.filter(e => groups[filter as ExtensionGroup].includes(e.id));
		}
		return result.sort((a, b) => a.name.localeCompare(b.name));
	}, [extensions, search, filter, groups]);

	const handleAssignGroup = useCallback(async (extId: string, group: ExtensionGroup | '') => {
		const newGroups = await assignToGroup(extId, group, groups);
		setGroups(newGroups);
	}, [groups]);

	const batchEnable = useCallback(async (exts: ExtensionInfo[]) => {
		for (const ext of exts) {
			await enableExtension(ext.id);
		}
		loadData();
	}, [loadData]);

	const batchDisable = useCallback(async (exts: ExtensionInfo[]) => {
		for (const ext of exts) {
			await disableExtension(ext.id);
		}
		loadData();
	}, [loadData]);

	return {
		hasPermission, extensions, groups, filter, setFilter, search, setSearch,
		loading, filtered, loadData, requestAccess, getExtGroup, handleAssignGroup,
		batchEnable, batchDisable
	};
}
