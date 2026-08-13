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

type ViewMode = 'enabled' | 'disabled' | 'all' | 'updates';

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { showModal } = useOverlay();
	const { loading, enabledModules, disabledModules, enable, disable } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const { scripts } = useUserScripts();
	const [view, setView] = useState<ViewMode>('all');
	const [scriptStatus, setScriptStatus] = useState<'all' | 'enabled' | 'disabled'>('all');
	const [scriptSource, setScriptSource] = useState<'all' | 'official' | 'user'>('all');
	const [filterType, setFilterType] = useState<FilterType>('all');
	const [changing, setChanging] = useState<string | null>(null);
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

	const handleEnable = useCallback(async (id: string) => {
		setChanging(id);
		try { await enable(id); } finally { setChanging(null); }
	}, [enable]);

	const handleDisable = useCallback(async (module: PluginMeta) => {
		// Custom user scripts are rows projected into the Module Store, not
		// packaged modules. Their lifecycle remains owned by User Scripts.
		if (module.isUserScript) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.scriptDisableWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		// `builtIn` is the sole packaged-module disable authority. Plugin
		// type is taxonomy only: optional system modules such as UserScripts are
		// intentionally optional and must reach ModuleManager.disable().
		if (module.builtIn) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.builtInDisableWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		if (module.pluginType === 'script') {
			showModal({
				type: 'confirm',
				title: t('moduleStorePanel.disable'),
				message: t('moduleStorePanel.scriptDisableConfirm'),
				confirmText: t('moduleStorePanel.disable'),
				onConfirm: () => disable(module.id),
			});
			return;
		}

		await disable(module.id);
	}, [disable, t, showModal]);

	const handleRefresh = useCallback(async () => { await refresh(); }, [refresh]);
	const searchModules = (modules: readonly PluginMeta[]) =>
		filterBySearch([...modules], searchQuery, MODULE_SEARCH_OPTIONS);

	const filterByType = (module: PluginMeta) => {
		if (filterType === 'system') return module.pluginType === 'system';
		if (filterType === 'script') {
			const isScript = module.pluginType === 'script' || module.isUserScript;
			if (!isScript) return false;
			const isUser = !!module.isUserScript;
			const isEnabled = isUser || enabledModules.some(item => item.id === module.id);
			if (scriptStatus === 'enabled' && !isEnabled) return false;
			if (scriptStatus === 'disabled' && isEnabled) return false;
			if (scriptSource === 'official' && isUser) return false;
			if (scriptSource === 'user' && !isUser) return false;
			return true;
		}
		if (filterType === 'app') return module.pluginType === 'tool';
		return true;
	};

	const scriptModules = React.useMemo(() => convertScriptsToModules(scripts), [scripts]);
	const allEnabledModules = React.useMemo(
		() => [...enabledModules, ...scriptModules],
		[enabledModules, scriptModules],
	);

	const getFilteredModules = () => {
		let source: readonly PluginMeta[] = [];
		if (view === 'enabled') source = allEnabledModules;
		else if (view === 'disabled') source = disabledModules;
		else source = [...ALL_MODULES, ...scriptModules];
		return searchModules(source.filter(filterByType));
	};

	const displayModules = getFilteredModules();
	const statsModules = allEnabledModules.filter(filterByType);
	const totalEnabled = statsModules.length;

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
				updatesCount={updates.length} totalEnabled={totalEnabled}
			/>
			<ModuleList
				displayModules={displayModules}
				enabledModules={allEnabledModules} changingId={changing}
				view={view} filterType={filterType}
				handleEnable={handleEnable} handleDisable={handleDisable}
			/>
		</div>
	);
};
