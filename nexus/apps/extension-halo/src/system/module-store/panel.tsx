import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { useModuleManager, useRemoteRegistry, ALL_MODULES } from '../../kernel';
import type { PluginMeta } from '../../kernel';
import { ModuleList } from './module-list';
import { StoreHeader } from './store-header';
import { useOverlay } from '../../components/ui/overlay';
import { useUserScripts } from '../../system/userscripts/hooks';
import { styles } from './panel.styles';
import type { FilterType } from './type-filter';
import { filterBySearch, MODULE_SEARCH_OPTIONS } from '../../kernel/utils/unified-search';
import { convertScriptsToModules } from './utils';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { showModal } = useOverlay();
	const { loading, installedModules, availableModules, install, uninstall } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const { scripts } = useUserScripts();
	const [view, setView] = useState<ViewMode>('all');
	const [scriptStatus, setScriptStatus] = useState<'all' | 'installed' | 'available'>('all');
	const [scriptSource, setScriptSource] = useState<'all' | 'official' | 'user'>('all');
	const [filterType, setFilterType] = useState<FilterType>('all');
	const [installing, setInstalling] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [isSearchFocused, setIsSearchFocused] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);

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

	const handleInstall = useCallback(async (id: string) => {
		setInstalling(id);
		try { await install(id); } finally { setInstalling(null); }
	}, [install]);

	const handleUninstall = useCallback(async (module: PluginMeta) => {
		// Custom user scripts are rows projected into the Module Store, not
		// packaged modules. Their lifecycle remains owned by User Scripts.
		if (module.isUserScript) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.scriptUninstallWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		// `builtIn` is the sole packaged-module uninstallability authority. Plugin
		// type is taxonomy only: optional system modules such as UserScripts are
		// intentionally removable and must reach ModuleManager.uninstall().
		if (module.builtIn) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.builtInUninstallWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		if (module.pluginType === 'script') {
			showModal({
				type: 'confirm',
				title: t('moduleStorePanel.uninstall'),
				message: t('moduleStorePanel.scriptUninstallConfirm'),
				confirmText: t('moduleStorePanel.uninstall'),
				onConfirm: () => uninstall(module.id),
			});
			return;
		}

		await uninstall(module.id);
	}, [uninstall, t, showModal]);

	const handleRefresh = useCallback(async () => { await refresh(); }, [refresh]);
	const searchModules = (modules: readonly PluginMeta[]) =>
		filterBySearch([...modules], searchQuery, MODULE_SEARCH_OPTIONS);

	const filterByType = (module: PluginMeta) => {
		if (filterType === 'system') return module.pluginType === 'system';
		if (filterType === 'script') {
			const isScript = module.pluginType === 'script' || module.isUserScript;
			if (!isScript) return false;
			const isUser = !!module.isUserScript;
			const isInstalled = isUser || installedModules.some(item => item.id === module.id);
			if (scriptStatus === 'installed' && !isInstalled) return false;
			if (scriptStatus === 'available' && isInstalled) return false;
			if (scriptSource === 'official' && isUser) return false;
			if (scriptSource === 'user' && !isUser) return false;
			return true;
		}
		if (filterType === 'app') return module.pluginType === 'tool';
		return true;
	};

	const scriptModules = React.useMemo(() => convertScriptsToModules(scripts), [scripts]);
	const allInstalledModules = React.useMemo(
		() => [...installedModules, ...scriptModules],
		[installedModules, scriptModules],
	);

	const getFilteredModules = () => {
		let source: readonly PluginMeta[] = [];
		if (view === 'installed') source = allInstalledModules;
		else if (view === 'available') source = availableModules;
		else source = [...ALL_MODULES, ...scriptModules];
		return searchModules(source.filter(filterByType));
	};

	const displayModules = getFilteredModules();
	const statsModules = allInstalledModules.filter(filterByType);
	const totalInstalled = statsModules.length;
	const totalSize = statsModules.reduce((sum, module) => sum + (module.size || 0), 0);

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
				searchQuery={searchQuery} setSearchQuery={setSearchQuery}
				isSearchFocused={isSearchFocused} setIsSearchFocused={setIsSearchFocused}
				searchInputRef={searchInputRef} handleRefresh={handleRefresh}
				remoteLoading={remoteLoading} filterType={filterType} setFilterType={setFilterType}
				view={view} setView={setView} hasUpdates={hasUpdates}
				scriptStatus={scriptStatus} setScriptStatus={setScriptStatus}
				scriptSource={scriptSource} setScriptSource={setScriptSource}
				updatesCount={updates.length} totalInstalled={totalInstalled} totalSize={totalSize}
			/>
			<ModuleList
				displayModules={displayModules}
				installedModules={allInstalledModules} installingId={installing}
				view={view} filterType={filterType}
				handleInstall={handleInstall} handleUninstall={handleUninstall}
			/>
		</div>
	);
};
