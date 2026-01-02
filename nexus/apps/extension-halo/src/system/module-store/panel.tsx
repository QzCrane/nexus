import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { useModuleManager } from '../../kernel';
import { useRemoteRegistry } from '../../kernel';
import { ALL_MODULES, formatModuleSize } from '../../kernel';
import { ModuleItem } from './module-item';
import { filterBySearch, MODULE_SEARCH_OPTIONS } from '../../kernel/utils/unified-search';
import { styles as searchStyles } from '../../components/SearchBar.styles';
import { styles } from './panel.styles';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';


export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { loading, installedModules, availableModules, getStatus, install, uninstall, isCore } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const [view, setView] = useState<ViewMode>('all');
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

	const handleInstall = useCallback(async (id: string) => {
		setInstalling(id);
		try { await install(id); } finally { setInstalling(null); }
	}, [install]);

	const handleUninstall = useCallback(async (id: string) => {
		await uninstall(id);
	}, [uninstall]);

	const handleRefresh = useCallback(async () => {
		await refresh();
	}, [refresh]);

	// System modules should not appear in the store
	const isIgnored = (id: string) => id === 'settings' || id === 'module-store' || id === 'permissions';

	const filteredInstalled = installedModules.filter(m => !isIgnored(m.id));
	const filteredAvailable = availableModules.filter(m => !isIgnored(m.id));
	const filteredAll = ALL_MODULES.filter(m => !isIgnored(m.id));

	// Use unified search engine (supports Pinyin + all locales)
	const searchModules = (modules: typeof ALL_MODULES) => 
		filterBySearch(modules, searchQuery, MODULE_SEARCH_OPTIONS);

	const displayModules = searchModules(
		view === 'installed' ? filteredInstalled
		: view === 'available' ? filteredAvailable
		: filteredAll
	);

	const totalInstalled = filteredInstalled.length;
	const totalSize = filteredInstalled.reduce((sum, m) => sum + (m.size || 0), 0);

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
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
					<div style={{
						...searchStyles.inputWrapper,
						...(isSearchFocused ? searchStyles.inputWrapperFocus : {}),
						flex: 1,
						padding: '4px 12px',
						height: '40px',
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
					<button style={{ ...styles.btnRefresh, height: '40px', width: '40px' }} onClick={handleRefresh} disabled={remoteLoading} title={t('moduleStorePanel.checkUpdates')}>
						{remoteLoading ? '⏳' : '🔄'}
					</button>
				</div>
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
					<span style={styles.stats}>{totalInstalled} installed • {formatModuleSize(totalSize)}</span>
				</div>
			</div>

			{view === 'updates' && updates.length > 0 ? (
				<div style={styles.list}>
					{updates.map((upd) => (
						<div key={upd.id} style={styles.item}>
							<span style={styles.icon as React.CSSProperties}>📦</span>
							<div style={styles.info}>
								<div style={styles.name}>
									{t(`tools.${upd.id}.name`) === `tools.${upd.id}.name` ? upd.id : t(`tools.${upd.id}.name`)}
									<span style={{ ...styles.badge, ...styles.badgeUpdate }}>{t('moduleStorePanel.update')}</span>
								</div>
								<div style={styles.desc}>v{upd.currentVersion} → v{upd.newVersion}</div>
								{upd.changelog && <div style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{upd.changelog}</div>}
							</div>
							<button style={{ ...styles.btn, ...styles.btnInstall }}>{t('moduleStorePanel.update')}</button>
						</div>
					))}
				</div>
			) : (
				<div style={styles.list}>
					{displayModules.length > 0 ? (
						displayModules.map((mod, index) => (
							<ModuleItem
								key={mod.id}
								index={index + 1}
								module={mod}
								status={installing === mod.id ? 'downloading' : getStatus(mod.id)}
								isCore={isCore(mod.id)}
								onInstall={() => handleInstall(mod.id)}
								onUninstall={() => handleUninstall(mod.id)}
							/>
						))
					) : (
						<div style={styles.empty}>
							<span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
							{view === 'available' ? t('moduleStorePanel.allInstalled') : t('moduleStorePanel.noModules')}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
