
import type React from 'react';
import { styles } from './panel.styles';
import { styles as searchStyles } from '../../components/search/SearchBar.styles';
import { TypeFilter, type FilterType } from './type-filter';
import { useTranslation } from '../../i18n';

type ViewMode = 'enabled' | 'disabled' | 'all' | 'updates';

interface StoreHeaderProps {
	searchQuery: string;
	setSearchQuery: (q: string) => void;
	isSearchFocused: boolean;
	setIsSearchFocused: (f: boolean) => void;
	searchInputRef: React.RefObject<HTMLInputElement | null>;
	handleRefresh: () => void;
	remoteLoading: boolean;
	filterType: FilterType;
	setFilterType: (f: FilterType) => void;
	view: ViewMode;
	setView: (v: ViewMode) => void;
	scriptStatus: 'all' | 'enabled' | 'disabled';
	setScriptStatus: (v: 'all' | 'enabled' | 'disabled') => void;
	scriptSource: 'all' | 'official' | 'user';
	setScriptSource: (v: 'all' | 'official' | 'user') => void;
	hasUpdates: boolean;
	updatesCount: number;
	totalEnabled: number;
}

export const StoreHeader: React.FC<StoreHeaderProps> = ({
	searchQuery, setSearchQuery, isSearchFocused, setIsSearchFocused, searchInputRef,
	handleRefresh, remoteLoading, filterType, setFilterType, view, setView,
	scriptStatus, setScriptStatus, scriptSource, setScriptSource,
	hasUpdates, updatesCount, totalEnabled
}) => {
	const { t } = useTranslation();
	const showScriptTabs = filterType === 'script';

	return (
		<div style={styles.header}>
			{/* Top Row: Search + Refresh */}
			<div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', marginBottom: '8px' }}>
				<label htmlFor="module-store-search" style={{
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
				>
				<span style={{ fontSize: '14px', opacity: 0.5, marginRight: '8px' }}>🔍</span>
					<input
						id="module-store-search"
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
				</label>
				<button type="button" style={{ ...styles.btnRefresh, height: '36px', width: '36px' }} onClick={handleRefresh} disabled={remoteLoading} title={t('moduleStorePanel.checkUpdates')}>
					{remoteLoading ? '⏳' : '🔄'}
				</button>
			</div>

			{/* Middle Row: Type Filters */}
			<TypeFilter value={filterType} onChange={setFilterType} />

			{/* Bottom Row: Tabs */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				{showScriptTabs ? (
					<div style={{ display: 'flex', gap: '16px' }}>
						{/* Status Group */}
						<div style={styles.tabs}>
							{(['all', 'enabled', 'disabled'] as const).map((v) => (
								<button type="button"
									key={v}
									style={{ ...styles.tab, ...(scriptStatus === v ? styles.tabActive : {}) }}
									onClick={() => setScriptStatus(v)}
								>
									{v === 'all' ? t('moduleStorePanel.all') : v === 'enabled' ? t('moduleStorePanel.enabled') : t('moduleStorePanel.disabled')}
								</button>
							))}
						</div>
						{/* Source Group */}
						<div style={styles.tabs}>
							{(['all', 'official', 'user'] as const).map((v) => (
								<button type="button"
									key={v}
									style={{ ...styles.tab, ...(scriptSource === v ? styles.tabActive : {}) }}
									onClick={() => setScriptSource(v)}
								>
									{v === 'all' ? t('moduleStorePanel.all') : v === 'official' ? t('common.builtInScripts') : t('common.userScripts')}
								</button>
							))}
						</div>
					</div>
				) : (
					<div style={styles.tabs}>
						{(['all', 'enabled', 'disabled'] as ViewMode[]).map((v) => (
							<button type="button"
								key={v}
								style={{ ...styles.tab, ...(view === v ? styles.tabActive : {}) }}
								onClick={() => setView(v)}
							>
								{v === 'all' ? t('moduleStorePanel.all') : v === 'enabled' ? t('moduleStorePanel.enabled') : t('moduleStorePanel.disabled')}
							</button>
						))}
						{hasUpdates && (
							<button type="button"
								style={{ ...styles.tab, ...(view === 'updates' ? styles.tabActive : styles.tabUpdate) }}
								onClick={() => setView('updates')}
							>
								{t('moduleStorePanel.updates')} ({updatesCount})
							</button>
						)}
					</div>
				)}
				<span style={styles.stats}>{t('moduleStorePanel.statsResult', { count: totalEnabled })}</span>
			</div>
		</div>
	);
};
