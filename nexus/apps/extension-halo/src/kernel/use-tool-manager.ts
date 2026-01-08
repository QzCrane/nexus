// goal: Tool management hooks
// eff: Search, filter, sort, pin/unpin, enable/disable

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ToolMeta, ToolPrefs } from './tool-registry';
import { TOOL_REGISTRY, DEFAULT_TOOL_PREFS, getReadyTools } from './tool-registry';
import { loadToolPrefs, saveToolPrefs } from './tool-prefs-storage';
import type { ToolCategory } from '../i18n/types';

function normalizeSearch(str: string): string {
	return str.toLowerCase().replace(/\s+/g, '');
}

function matchesSearch(tool: ToolMeta, query: string): boolean {
	if (!query) return true;
	const q = normalizeSearch(query);
	if (tool.id.includes(q)) return true;
	return tool.keywords.some((kw) => normalizeSearch(kw).includes(q));
}

export type SortMode = 'name' | 'usage' | 'category';

export interface UseToolManagerResult {
	tools: ToolMeta[];
	prefs: Record<string, ToolPrefs>;
	ready: boolean;
	searchQuery: string;
	setSearchQuery: (q: string) => void;
	sortMode: SortMode;
	setSortMode: (m: SortMode) => void;
	categoryFilter: ToolCategory | 'all' | 'pinned';
	setCategoryFilter: (c: ToolCategory | 'all' | 'pinned') => void;
	toggleEnabled: (id: string) => void;
	togglePinned: (id: string) => void;
	incrementUsage: (id: string) => void;
	enableAll: () => void;
	disableAllExceptSettings: () => void;
	resetPrefs: () => void;
	filteredTools: ToolMeta[];
	pinnedTools: ToolMeta[];
	enabledTools: ToolMeta[];
}

export function useToolManager(): UseToolManagerResult {
	const [prefs, setPrefs] = useState<Record<string, ToolPrefs>>({});
	const [ready, setReady] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [sortMode, setSortMode] = useState<SortMode>('category');
	const [categoryFilter, setCategoryFilter] = useState<ToolCategory | 'all' | 'pinned'>('all');

	useEffect(() => {
		loadToolPrefs().then((p) => {
			setPrefs(p);
			setReady(true);
		});
	}, []);

	const getPrefs = useCallback((id: string): ToolPrefs => {
		return prefs[id] || DEFAULT_TOOL_PREFS;
	}, [prefs]);

	const updatePrefs = useCallback(async (id: string, update: Partial<ToolPrefs>) => {
		const current = prefs[id] || DEFAULT_TOOL_PREFS;
		const updated = { ...current, ...update };
		const newPrefs = { ...prefs, [id]: updated };
		setPrefs(newPrefs);
		await saveToolPrefs(newPrefs);
	}, [prefs]);

	const toggleEnabled = useCallback((id: string) => {
		if (id === 'settings') return;
		const current = getPrefs(id);
		updatePrefs(id, { enabled: !current.enabled });
	}, [getPrefs, updatePrefs]);

	const togglePinned = useCallback((id: string) => {
		const current = getPrefs(id);
		updatePrefs(id, { pinned: !current.pinned });
	}, [getPrefs, updatePrefs]);

	const incrementUsage = useCallback((id: string) => {
		const current = getPrefs(id);
		updatePrefs(id, { usageCount: current.usageCount + 1, lastUsed: Date.now() });
	}, [getPrefs, updatePrefs]);

	const enableAll = useCallback(async () => {
		const newPrefs = { ...prefs };
		for (const tool of TOOL_REGISTRY) {
			newPrefs[tool.id] = { ...getPrefs(tool.id), enabled: true };
		}
		setPrefs(newPrefs);
		await saveToolPrefs(newPrefs);
	}, [prefs, getPrefs]);

	const disableAllExceptSettings = useCallback(async () => {
		const newPrefs = { ...prefs };
		for (const tool of TOOL_REGISTRY) {
			if (tool.id !== 'settings') {
				newPrefs[tool.id] = { ...getPrefs(tool.id), enabled: false };
			}
		}
		setPrefs(newPrefs);
		await saveToolPrefs(newPrefs);
	}, [prefs, getPrefs]);

	const resetPrefs = useCallback(async () => {
		setPrefs({});
		await saveToolPrefs({});
	}, []);

	const filteredTools = useMemo(() => {
		let list = [...TOOL_REGISTRY];
		if (searchQuery) {
			list = list.filter((t) => matchesSearch(t, searchQuery));
		}
		if (categoryFilter === 'pinned') {
			list = list.filter((t) => getPrefs(t.id).pinned);
		} else if (categoryFilter !== 'all') {
			list = list.filter((t) => t.category === categoryFilter);
		}
		if (sortMode === 'name') {
			list.sort((a, b) => a.id.localeCompare(b.id));
		} else if (sortMode === 'usage') {
			list.sort((a, b) => getPrefs(b.id).usageCount - getPrefs(a.id).usageCount);
		} else {
			const catOrder: ToolCategory[] = ['general', 'dev', 'efficiency', 'visual', 'ai'];
			list.sort((a, b) => {
				const pinnedA = getPrefs(a.id).pinned ? 0 : 1;
				const pinnedB = getPrefs(b.id).pinned ? 0 : 1;
				if (pinnedA !== pinnedB) return pinnedA - pinnedB;
				return catOrder.indexOf(a.category) - catOrder.indexOf(b.category);
			});
		}
		return list;
	}, [searchQuery, categoryFilter, sortMode, getPrefs]);

	const pinnedTools = useMemo(() => {
		return TOOL_REGISTRY.filter((t) => getPrefs(t.id).pinned);
	}, [getPrefs]);

	const enabledTools = useMemo(() => {
		return getReadyTools().filter((t) => getPrefs(t.id).enabled);
	}, [getPrefs]);

	return {
		tools: TOOL_REGISTRY,
		prefs,
		ready,
		searchQuery,
		setSearchQuery,
		sortMode,
		setSortMode,
		categoryFilter,
		setCategoryFilter,
		toggleEnabled,
		togglePinned,
		incrementUsage,
		enableAll,
		disableAllExceptSettings,
		resetPrefs,
		filteredTools,
		pinnedTools,
		enabledTools,
	};
}
