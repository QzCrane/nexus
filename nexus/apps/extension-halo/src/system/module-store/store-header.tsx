
import React from 'react';
import { styles } from './panel.styles';
import { styles as searchStyles } from '../../components/SearchBar.styles';
import { formatModuleSize, ALL_MODULES } from '../../kernel';
import { TypeFilter, FilterType } from './type-filter';
import { useTranslation } from '../../i18n';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

interface StoreHeaderProps {
	searchQuery: string;
	setSearchQuery: (q: string) => void;
	isSearchFocused: boolean;
	setIsSearchFocused: (f: boolean) => void;
	searchInputRef: React.RefObject<HTMLInputElement>;
	handleRefresh: () => void;
	remoteLoading: boolean;
	filterType: FilterType;
	setFilterType: (f: FilterType) => void;
	view: ViewMode;
	setView: (v: ViewMode) => void;
	scriptView: 'all' | 'official' | 'user';
	setScriptView: (v: 'all' | 'official' | 'user') => void;
	hasUpdates: boolean;
	updatesCount: number;
	totalInstalled: number;
	totalSize: number;
}

export const StoreHeader: React.FC<StoreHeaderProps> = ({
	searchQuery, setSearchQuery, isSearchFocused, setIsSearchFocused, searchInputRef,
	handleRefresh, remoteLoading, filterType, setFilterType, view, setView,
	scriptView, setScriptView,
	hasUpdates, updatesCount, totalInstalled, totalSize
}) => {
	const { t } = useTranslation();
	const showScriptTabs = filterType === 'script';

	return (
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
					{showScriptTabs ? (
						(['all', 'official', 'user'] as const).map((v) => (
							<button
								key={v}
								style={{ ...styles.tab, ...(scriptView === v ? styles.tabActive : {}) }}
								onClick={() => setScriptView(v)}
							>
								{v === 'all' ? t('moduleStorePanel.all') : v === 'official' ? t('common.builtInScripts') : t('common.userScripts')}
							</button>
						))
					) : (
						<>
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
									{t('moduleStorePanel.updates')} ({updatesCount})
								</button>
							)}
						</>
					)}
				</div>
				<span style={styles.stats}>{t('moduleStorePanel.statsResult', { count: totalInstalled, size: formatModuleSize(totalSize) })}</span>
			</div>
		</div>
	);
};
