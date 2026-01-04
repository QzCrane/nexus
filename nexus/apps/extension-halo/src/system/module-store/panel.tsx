import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { useToolInstall, useRemoteRegistry, ALL_TOOLS } from '../../kernel';
import { ToolList } from './tool-list';
import { StoreHeader } from './store-header';
import { useOverlay } from '../../components/ui/overlay';
import { useUserScripts } from '../../system/userscripts/hooks';
import { styles } from './panel.styles';
import { FilterType } from './type-filter';
import { filterBySearch, MODULE_SEARCH_OPTIONS } from '../../kernel/utils/unified-search';
import { convertScriptsToTools } from './utils';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { showModal } = useOverlay();
	const { loading, installedTools, availableTools, install, uninstall } = useToolInstall();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const { scripts } = useUserScripts();
	const [view, setView] = useState<ViewMode>('all');
	const [scriptStatus, setScriptStatus] = useState<'all' | 'installed' | 'available'>('all');
	const [scriptSource, setScriptSource] = useState<'all' | 'official' | 'user'>('all');
	const [filterType, setFilterType] = useState<FilterType>('all');
	const [installing, setInstalling] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');

	const handleInstall = useCallback(async (id: string) => {
		setInstalling(id);
		try { await install(id); } finally { setInstalling(null); }
	}, [install]);

	const handleUninstall = useCallback(async (m: typeof ALL_TOOLS[0]) => {
		// System components cannot be uninstalled
		if (m.system) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.systemUninstallWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		// User Scripts (custom) are managed in UserScripts panel
		if ((m as any).isUserScript) {
			showModal({
				title: t('common.readOnly') || '只读',
				message: t('moduleStorePanel.scriptUninstallWarning'),
				confirmText: t('moduleStorePanel.close') || '关闭',
			});
			return;
		}

		// Official Scripts require confirmation
		if (m.toolType === 'script') {
			showModal({
				type: 'confirm',
				title: t('moduleStorePanel.uninstall'),
				message: t('moduleStorePanel.scriptUninstallConfirm'),
				confirmText: t('moduleStorePanel.uninstall'),
				onConfirm: () => uninstall(m.id)
			});
			return;
		}

		await uninstall(m.id);
	}, [uninstall, t, showModal]);

	const handleRefresh = useCallback(async () => { await refresh(); }, [refresh]);

	const searchTools = (tools: typeof ALL_TOOLS) => 
		filterBySearch(tools, searchQuery, MODULE_SEARCH_OPTIONS);

	const filterByType = (m: typeof ALL_TOOLS[0] & { isUserScript?: boolean }) => {
		if (filterType === 'system') return m.system;
		if (filterType === 'script') {
			const isScript = !m.system && (m.toolType === 'script' || m.isUserScript);
			if (!isScript) return false;
			
			const isUser = !!m.isUserScript;
			// Check if installed (User scripts are always installed, Official checks installedTools)
			const isInstalled = isUser || installedTools.some(im => im.id === m.id);

			// Filter by Status
			if (scriptStatus === 'installed' && !isInstalled) return false;
			if (scriptStatus === 'available' && isInstalled) return false;

			// Filter by Source
			if (scriptSource === 'official' && isUser) return false;
			if (scriptSource === 'user' && !isUser) return false;

			return true;
		}
		if (filterType === 'app') return !m.system && (!m.toolType || m.toolType === 'panel');
		return true;
	};

	// Convert user scripts to tools (exclude SaaT scripts already in ALL_TOOLS)
	const scriptTools = React.useMemo(() => convertScriptsToTools(scripts), [scripts]);
	const allInstalledTools = React.useMemo(() => [...installedTools, ...scriptTools], [installedTools, scriptTools]);

	const getFilteredTools = () => {
		let source: typeof ALL_TOOLS = [];
		if (view === 'installed') source = allInstalledTools;
		else if (view === 'available') source = availableTools;
		else source = [...ALL_TOOLS, ...scriptTools];
		return searchTools(source.filter(filterByType));
	};

	const displayTools = getFilteredTools();
	const statsTools = allInstalledTools.filter(filterByType);
	const totalInstalled = statsTools.length;
	const totalSize = statsTools.reduce((sum, m) => sum + (m.size || 0), 0);

	// Modal Component Styles - Moved to modal.tsx

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
				handleRefresh={handleRefresh}
				remoteLoading={remoteLoading} filterType={filterType} setFilterType={setFilterType}
				view={view} setView={setView} hasUpdates={hasUpdates}
				scriptStatus={scriptStatus} setScriptStatus={setScriptStatus}
				scriptSource={scriptSource} setScriptSource={setScriptSource}
				updatesCount={updates.length} totalInstalled={totalInstalled} totalSize={totalSize}
			/>
			<ToolList
				updates={updates} displayTools={displayTools}
				installedTools={allInstalledTools} installingId={installing}
				view={view} filterType={filterType}
				handleInstall={handleInstall} handleUninstall={handleUninstall}
			/>
			
		</div>
	);
};
