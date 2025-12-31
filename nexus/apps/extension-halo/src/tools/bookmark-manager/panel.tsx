// goal: Bookmark Manager panel UI - search and manage bookmarks

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { BookmarkSearchResult } from './types';
import { searchBookmarks, getRecentBookmarks, deleteBookmark, openBookmark, getFaviconUrl } from './core';
import { styles } from './panel.styles';

type ViewMode = 'search' | 'recent';

export const BookmarkManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<ViewMode>('recent');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<BookmarkSearchResult[]>([]);
	const [loading, setLoading] = useState(false);

	// Load recent on mount
	useEffect(() => {
		if (mode === 'recent') {
			setLoading(true);
			getRecentBookmarks(30).then((items) => {
				setResults(items);
				setLoading(false);
			});
		}
	}, [mode]);

	// Search bookmarks
	useEffect(() => {
		if (mode === 'search' && query.length >= 2) {
			setLoading(true);
			const timer = setTimeout(() => {
				searchBookmarks(query).then((items) => {
					setResults(items);
					setLoading(false);
				});
			}, 200);
			return () => clearTimeout(timer);
		} else if (mode === 'search') {
			setResults([]);
		}
	}, [query, mode]);

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

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, ...(mode === 'recent' ? styles.active : styles.inactive) }} onClick={() => setMode('recent')}>
					⏱️ {t('bookmarkManager.recent')}
				</button>
				<button style={{ ...styles.tab, ...(mode === 'search' ? styles.active : styles.inactive) }} onClick={() => setMode('search')}>
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
					autoFocus
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
						<div key={item.id} style={styles.item} onClick={(e) => handleClick(item.url, e)}>
							<img src={getFaviconUrl(item.url)} alt="" style={styles.favicon} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
							<div style={styles.info}>
								<div style={styles.title}>{item.title || item.url}</div>
								<div style={styles.url}>{item.url}</div>
							</div>
							{item.parentTitle && <span style={styles.folder}>{item.parentTitle}</span>}
							<button style={styles.btn} onClick={(e) => handleDelete(item.id, e)}>🗑️</button>
						</div>
					))
				)}
			</div>
		</div>
	);
};
