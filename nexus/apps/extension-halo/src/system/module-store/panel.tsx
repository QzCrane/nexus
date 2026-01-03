
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { useModuleManager } from '../../kernel';
import { useRemoteRegistry } from '../../kernel';
import { ALL_MODULES, formatModuleSize } from '../../kernel';
import { ModuleList } from './module-list';
import { StoreHeader } from './store-header';
import { useUserScripts } from '../../system/userscripts/hooks';
import { styles } from './panel.styles';
import { FilterType } from './type-filter';
import { filterBySearch, MODULE_SEARCH_OPTIONS } from '../../kernel/utils/unified-search';
import { UserScript } from '../../system/userscripts/types';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

interface ModuleListProps {
	updates: string[];
	displayModules: typeof ALL_MODULES;
	installedModules: typeof ALL_MODULES;
	installingId: string | null;
	view: ViewMode;
	handleInstall: (id: string) => void;
	handleUninstall: (m: typeof ALL_MODULES[0]) => void;
	userScripts: UserScript[]; // Injected user scripts
}

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { loading, installedModules, availableModules, getStatus, install, uninstall, isCore } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const { scripts } = useUserScripts();
	const [view, setView] = useState<ViewMode>('all');
	const [filterType, setFilterType] = useState<FilterType>('all');
	const [installing, setInstalling] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [isSearchFocused, setIsSearchFocused] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Ctrl+K keyboard shortcut
	useEffect(() => {
		const handleGlobalKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				searchInputRef.current?.focus();
			}
		};
		window.addEventListener('keydown', handleGlobalKey);
		return () => window.removeEventListener('keydown', handleGlobalKey);
	}, []);

	// Assuming installModule, uninstallModule, and loadData are defined elsewhere or will be added.
	// For now, using the original install/uninstall from useModuleManager for handleInstall/handleUninstall
	// if installModule/uninstallModule are not provided.
	// The instruction implies these new functions, so I'll add placeholders if they don't exist.
	// Given the context, it's likely `install` and `uninstall` from `useModuleManager` are intended.
	// However, the instruction explicitly provides new function bodies.
	// I will assume `installModule` and `uninstallModule` are meant to be the `install` and `uninstall` from `useModuleManager`
	// and `loadData` is a function that refreshes the module list.
	// Since `loadData` is not defined, I'll make a placeholder for it.
	const loadData = useCallback(() => {
		// This function would typically refresh the module lists.
		// For this context, we might need to call refresh() or re-fetch module states.
		// As per the original code, `installedModules` and `availableModules` are reactive,
		// so `loadData` might not be strictly necessary if `install` and `uninstall`
		// from `useModuleManager` already trigger updates.
		// However, to faithfully follow the instruction, I'll keep the call.
		// If `installModule` and `uninstallModule` are indeed `install` and `uninstall` from `useModuleManager`,
		// then `loadData` might be redundant.
	}, []);

	const handleInstall = useCallback(async (id: string) => {
		setInstalling(id);
		try { await install(id); } finally { setInstalling(null); }
		loadData(); // Added loadData as per instruction
	}, [install, loadData]);

	const handleUninstall = useCallback(async (m: typeof ALL_MODULES[0]) => {
		if (m.toolType === 'script') {
			// Prevent uninstallation of scripts in Store
			// Ideally show a Toast, here using alert as fallback or just log
			// Using confirm-style alert for visibility
			// Note: We don't have a Toast component imported here yet
			window.alert(t('moduleStorePanel.scriptUninstallWarning'));
			return;
		}
		await uninstall(m.id); // Using `uninstall` from useModuleManager
		loadData();
	}, [uninstall, loadData, t]);

	const handleRefresh = useCallback(async () => {
		await refresh();
	}, [refresh]);

	// Use unified search engine (supports Pinyin + all locales)
	const searchModules = (modules: typeof ALL_MODULES) => 
		filterBySearch(modules, searchQuery, MODULE_SEARCH_OPTIONS);

	// Helper to filter by type
	const filterByType = (m: typeof ALL_MODULES[0]) => {
		if (filterType === 'system') return m.system;
		if (filterType === 'script') return !m.system && m.toolType === 'script';
		if (filterType === 'app') return !m.system && (!m.toolType || m.toolType === 'panel');
		return true;
	};

	// Convert scripts to modules (Memoized)
	const scriptModules = React.useMemo(() => scripts.map(s => ({
		id: s.id,
		name: s.name,
		description: s.description,
		icon: '📜',
		category: 'scripts',
		toolType: 'script',
		builtIn: false,
		size: s.code.length,
		system: false,
		status: 'ready',
		keywords: ['script', 'user']
	})) as typeof ALL_MODULES, [scripts]);

	// Combined installed list for status checks
	const allInstalledModules = React.useMemo(() => [...installedModules, ...scriptModules], [installedModules, scriptModules]);

	const getFilteredModules = () => {
		// 1. Filter by Status (View)
		let source: typeof ALL_MODULES = [];

		if (view === 'installed') {
			source = allInstalledModules;
		} else if (view === 'available') {
			source = availableModules; // User scripts aren't "available" in store
		} else { // all
			source = [...ALL_MODULES];
		}

		// 2. Filter by Type
		source = source.filter(filterByType);

		// 3. Filter by Search
		return searchModules(source);
	};

	const displayModules = getFilteredModules();

	const statsModules = allInstalledModules.filter(filterByType);
	const totalInstalled = statsModules.length;
	const totalSize = statsModules.reduce((sum, m) => sum + (m.size || 0), 0);


	if (loading) {
		return (
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
				<div style={styles.empty}>
					<span style={{ fontSize: '24px' }}>⏳</span>
					{t('moduleStorePanel.loading')}
				</div>
			</div>
		);
	}

	return (
		<div style={styles.wrapper}>
			<StoreHeader
				searchQuery={searchQuery}
				setSearchQuery={setSearchQuery}
				isSearchFocused={isSearchFocused}
				setIsSearchFocused={setIsSearchFocused}
				searchInputRef={searchInputRef}
				handleRefresh={handleRefresh}
				remoteLoading={remoteLoading}
				filterType={filterType}
				setFilterType={setFilterType}
				view={view}
				setView={setView}
				hasUpdates={hasUpdates}
				updatesCount={updates.length}
				totalInstalled={totalInstalled}
				totalSize={totalSize}
			/>

			<ModuleList
				updates={updates}
				displayModules={displayModules}
				installedModules={allInstalledModules}
				installingId={installing}
				view={view}
				filterType={filterType}
				handleInstall={handleInstall}
				handleUninstall={handleUninstall}
			/>
		</div>
	);
};
