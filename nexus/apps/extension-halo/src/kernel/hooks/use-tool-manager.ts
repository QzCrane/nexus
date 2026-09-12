// goal: Tool management hooks
// eff: Helpers extracted to external files

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ToolMeta, ToolPrefs } from '../core/tool-registry-types';
import { TOOL_REGISTRY, DEFAULT_TOOL_PREFS, getReadyTools } from '../registry/tool-registry';
import { loadToolPrefs, saveToolPrefs } from '../utils/tool-storage-utils';
import { matchesSearch } from '../utils/tool-search-utils';
import type { ToolCategory } from '../../i18n/types';

export type SortMode = 'name' | 'usage' | 'category';

export interface UseToolManagerResult {
	// Data
	tools: ToolMeta[];
	prefs: Record<string, ToolPrefs>;
	ready: boolean;
	// State
	searchQuery: string;
	setSearchQuery: (q: string) => void;
	sortMode: SortMode;
	setSortMode: (m: SortMode) => void;
	categoryFilter: ToolCategory | 'all' | 'pinned';
	setCategoryFilter: (c: ToolCategory | 'all' | 'pinned') => void;
	// Actions
	toggleEnabled: (id: string) => void;
	togglePinned: (id: string) => void;
	incrementUsage: (id: string) => void;
	enableAll: () => void;
	disableAllExceptSettings: () => void;
	resetPrefs: () => void;
	// Computed
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

	// Load on mount
	useEffect(() => {
		// rule: track mount state so the .catch handler doesn't call setReady on
		// an unmounted component (React warning + stale state write).
		let mounted = true;
		loadToolPrefs().then((p) => {
			if (!mounted) return;
			setPrefs(p);
			setReady(true);
		}).catch((e) => {
			console.error('useToolManager: loadToolPrefs failed', e);
			if (mounted) setReady(true);
		});
		return () => { mounted = false; };
	}, []);

	// Get prefs for a tool (with defaults)
	const getPrefs = useCallback((id: string): ToolPrefs => {
		return prefs[id] || DEFAULT_TOOL_PREFS;
	}, [prefs]);

	// Update prefs helper
	const updatePrefs = useCallback(async (id: string, update: Partial<ToolPrefs>) => {
		const current = prefs[id] || DEFAULT_TOOL_PREFS;
		const updated = { ...current, ...update };
		const newPrefs = { ...prefs, [id]: updated };
		await saveToolPrefs(newPrefs);
		setPrefs(newPrefs);
	}, [prefs]);

	const toggleEnabled = useCallback((id: string) => {
		// Settings always enabled
		if (id === 'settings') return;
		const current = getPrefs(id);
		void updatePrefs(id, { enabled: !current.enabled }).catch((error: unknown) => console.error('Tool enabled preference was not saved', error));
	}, [getPrefs, updatePrefs]);

	const togglePinned = useCallback((id: string) => {
		const current = getPrefs(id);
		void updatePrefs(id, { pinned: !current.pinned }).catch((error: unknown) => console.error('Tool pinned preference was not saved', error));
	}, [getPrefs, updatePrefs]);

	const incrementUsage = useCallback((id: string) => {
		const current = getPrefs(id);
		void updatePrefs(id, {
			usageCount: current.usageCount + 1,
			lastUsed: Date.now()
		}).catch((error: unknown) => console.error('Tool usage preference was not saved', error));
	}, [getPrefs, updatePrefs]);

	const enableAll = useCallback(async () => {
		const newPrefs = { ...prefs };
		for (const tool of TOOL_REGISTRY) {
			newPrefs[tool.id] = { ...getPrefs(tool.id), enabled: true };
		}
		await saveToolPrefs(newPrefs);
		setPrefs(newPrefs);
	}, [prefs, getPrefs]);

	const disableAllExceptSettings = useCallback(async () => {
		const newPrefs = { ...prefs };
		for (const tool of TOOL_REGISTRY) {
			if (tool.id !== 'settings') {
				newPrefs[tool.id] = { ...getPrefs(tool.id), enabled: false };
			}
		}
		await saveToolPrefs(newPrefs);
		setPrefs(newPrefs);
	}, [prefs, getPrefs]);

	const resetPrefs = useCallback(async () => {
		await saveToolPrefs({});
		setPrefs({});
	}, []);

	// Computed values
	const filteredTools = useMemo(() => {
		let list = [...TOOL_REGISTRY];

		// Search filter
		if (searchQuery) {
			list = list.filter((t) => matchesSearch(t, searchQuery));
		}

		// Category filter
		if (categoryFilter === 'pinned') {
			list = list.filter((t) => getPrefs(t.id).pinned);
		} else if (categoryFilter !== 'all') {
			list = list.filter((t) => t.category === categoryFilter);
		}

		// Sort
		if (sortMode === 'name') {
			list.sort((a, b) => a.id.localeCompare(b.id));
		} else if (sortMode === 'usage') {
			list.sort((a, b) => getPrefs(b.id).usageCount - getPrefs(a.id).usageCount);
		} else {
			// By category, then by pinned
			const catOrder: ToolCategory[] = ['general', 'encode', 'format', 'network', 'data', 'dev', 'efficiency', 'browser', 'visual', 'media', 'security', 'ai', 'active', 'scripts', 'system'];
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
