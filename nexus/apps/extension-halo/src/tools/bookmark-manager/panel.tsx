// goal: Bookmark Manager panel UI - search and manage bookmarks

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { BookmarkSearchResult } from './types';
import { searchBookmarks, getRecentBookmarks, deleteBookmark, openBookmark, getFaviconUrl } from './core';
import { styles } from './panel.styles';
import { useToolState, usePermission } from '../../kernel';


type ViewMode = 'search' | 'recent';

export const BookmarkManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { hasPermission, request } = usePermission('bookmarks');
	const [mode, setMode] = useToolState<ViewMode>('bookmark-mode', 'recent');
	const [query, setQuery] = useToolState<string>('bookmark-query', '');

	const [results, setResults] = useState<BookmarkSearchResult[]>([]);
	const [loading, setLoading] = useState(false);

	// Load recent on mount
	useEffect(() => {
		if (hasPermission !== false && mode === 'recent') {
			setLoading(true);
			getRecentBookmarks(30).then((items) => {
				setResults(items);
				setLoading(false);
			});
		}
	}, [mode, hasPermission]);

	// Search bookmarks
	useEffect(() => {
		if (hasPermission !== false && mode === 'search' && query.length >= 2) {
			setLoading(true);
			const timer = setTimeout(() => {
				searchBookmarks(query).then((items) => {
					setResults(items);
					setLoading(false);
				});
			}, 200);
			return () => clearTimeout(timer);
		} else if (hasPermission !== false && mode === 'search') {
			setResults([]);
		}
	}, [query, mode, hasPermission]);

	// Handle click
	const handleClick = useCallback((url: string, e: React.MouseEvent) => {
		openBookmark(url, e.ctrlKey || e.metaKey);
	}, []);

	// Handle delete
	const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		await deleteBookmark(id);
		setResults((r) => r.filter((x) => x.id !== id));
	}, []);

	if (hasPermission === false) {
		return (
			<div style={{ ...styles.wrapper, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
				<div style={{ width: '100%', maxWidth: '320px' }}>
					<Card variant="default" padding="md">
						<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '32px 16px' }}>
							<span style={{ fontSize: '48px', opacity: 0.8 }}>🔒</span>
							<div style={{ textAlign: 'center' }}>
								<h3 style={{ margin: '0 0 8px 0', color: 'var(--halo-text)' }}>{t('common.permissionRequired')}</h3>
								<p style={{ margin: 0, fontSize: '13px', color: 'var(--halo-text-secondary)' }}>{t('common.permissionDesc')}</p>
							</div>
							<button type="button"
								onClick={request}
								style={{ 
									padding: '8px 24px', 
									background: 'var(--halo-accent)', 
									color: '#fff', 
									border: 'none', 
									borderRadius: '6px', 
									cursor: 'pointer',
									fontWeight: 500,
									transition: 'opacity 0.2s'
								}}
							>
								{t('common.grantPermission')}
							</button>
						</div>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button type="button" style={{ ...styles.tab, ...(mode === 'recent' ? styles.active : styles.inactive) }} onClick={() => setMode('recent')}>
					⏱️ {t('bookmarkManager.recent')}
				</button>
				<button type="button" style={{ ...styles.tab, ...(mode === 'search' ? styles.active : styles.inactive) }} onClick={() => setMode('search')}>
					🔍 {t('bookmarkManager.search')}
				</button>
			</div>

			{/* Search Input */}
			{mode === 'search' && (
				<input
					style={styles.search}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t('bookmarkManager.searchPlaceholder')}
				/>
			)}

			{/* Results */}
			<div style={styles.list}>
				{loading ? (
					<div style={styles.empty}>⏳ {t('bookmarkManager.loading')}</div>
				) : results.length === 0 ? (
					<div style={styles.empty}>📚 {mode === 'search' ? t('bookmarkManager.noResults') : t('bookmarkManager.noRecent')}</div>
				) : (
					results.map((item) => (
						<div key={item.id} style={{ ...styles.item, cursor: 'default' }}>
							<button
								type="button"
								onClick={(e) => handleClick(item.url, e)}
								style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
							>
								<img src={getFaviconUrl(item.url)} alt="" style={styles.favicon} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
								<span style={styles.info}>
									<span style={{ ...styles.title, display: 'block' }}>{item.title || item.url}</span>
									<span style={{ ...styles.url, display: 'block' }}>{item.url}</span>
								</span>
								{item.parentTitle && <span style={styles.folder}>{item.parentTitle}</span>}
							</button>
							<button type="button" style={styles.btn} onClick={(e) => handleDelete(item.id, e)}>🗑️</button>
						</div>
					))
				)}
			</div>
		</div>
	);
};
