
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { useModuleManager } from '../../kernel';
import { useRemoteRegistry } from '../../kernel';
import { ALL_MODULES, formatModuleSize } from '../../kernel';
import { ModuleList } from './module-list';
import { TypeFilter, FilterType } from './type-filter';
import { filterBySearch, MODULE_SEARCH_OPTIONS } from '../../kernel/utils/unified-search';
import { styles as searchStyles } from '../../components/SearchBar.styles';
import { styles } from './panel.styles';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { loading, installedModules, availableModules, getStatus, install, uninstall, isCore } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
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

	const getFilteredModules = () => {
		// 1. Filter by Status (View)
		let source = view === 'installed' ? installedModules
			: view === 'available' ? availableModules
			: ALL_MODULES;
		
		// 2. Filter by Type
		source = source.filter(filterByType);

		// 3. Filter by Search
		return searchModules(source);
	};

	const displayModules = getFilteredModules();

	const statsModules = installedModules.filter(filterByType);
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
			<div style={styles.header}>
				{/* Top Row: Search + Refresh */}
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', marginBottom: '8px' }}>
					<div style={{
						...searchStyles.inputWrapper,
						...(isSearchFocused ? searchStyles.inputWrapperFocus : {}),
						flex: 1,
						padding: '4px 12px',
						height: '36px',
						background: 'var(--halo-bg-secondary)',
						display: 'flex',
						alignItems: 'center',
						cursor: 'text'
					}}
					onClick={() => searchInputRef.current?.focus()}
					>
					<span style={{ fontSize: '14px', opacity: 0.5, marginRight: '8px' }}>🔍</span>
						<input
							ref={searchInputRef}
							style={{ ...searchStyles.input as React.CSSProperties, fontSize: '14px', width: '100%' }}
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onFocus={() => setIsSearchFocused(true)}
							onBlur={() => setIsSearchFocused(false)}
							placeholder={t('moduleStorePanel.searchPlaceholder') || t('common.search')}
						/>
						{!isSearchFocused && !searchQuery && <span style={searchStyles.shortcut as React.CSSProperties}>⌘K</span>}
					</div>
					<button style={{ ...styles.btnRefresh, height: '36px', width: '36px' }} onClick={handleRefresh} disabled={remoteLoading} title={t('moduleStorePanel.checkUpdates')}>
						{remoteLoading ? '⏳' : '🔄'}
					</button>
				</div>

				{/* Middle Row: Type Filters */}
				<TypeFilter value={filterType} onChange={setFilterType} />

				{/* Bottom Row: Tabs */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div style={styles.tabs}>
						{(['all', 'installed', 'available'] as ViewMode[]).map((v) => (
							<button
								key={v}
								style={{ ...styles.tab, ...(view === v ? styles.tabActive : {}) }}
								onClick={() => setView(v)}
							>
								{v === 'all' ? t('moduleStorePanel.all') : v === 'installed' ? t('moduleStorePanel.installed') : t('moduleStorePanel.available')}
							</button>
						))}
						{hasUpdates && (
							<button
								style={{ ...styles.tab, ...(view === 'updates' ? styles.tabActive : styles.tabUpdate) }}
								onClick={() => setView('updates')}
							>
								{t('moduleStorePanel.updates')} ({updates.length})
							</button>
						)}
					</div>
					<span style={styles.stats}>{t('moduleStorePanel.statsResult', { count: totalInstalled, size: formatModuleSize(totalSize) })}</span>
				</div>
			</div>

			<ModuleList
				updates={updates}
				displayModules={displayModules}
				installedModules={installedModules}
				installingId={installing}
				view={view}
				handleInstall={handleInstall}
				handleUninstall={handleUninstall}
			/>
		</div>
	);
};
