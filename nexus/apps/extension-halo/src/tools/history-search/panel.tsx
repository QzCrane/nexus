// goal: History Search panel UI - search and browse history

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { HistoryItem } from './types';
import { searchHistory, deleteHistoryItem, getRecentHistory, formatTimeAgo, getFaviconUrl } from './core';
import { styles } from './panel.styles';

export const HistorySearchPanel: React.FC = () => {
	const { t } = useTranslation();
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<HistoryItem[]>([]);
	const [loading, setLoading] = useState(true);

	// Load recent on mount
	useEffect(() => {
		getRecentHistory(50).then((items) => {
			setResults(items);
			setLoading(false);
		});
	}, []);

	// Search on query change
	useEffect(() => {
		const timer = setTimeout(async () => {
			if (query.length >= 2) {
				setLoading(true);
				const items = await searchHistory(query, 100);
				setResults(items);
				setLoading(false);
			} else if (query.length === 0) {
				setLoading(true);
				const items = await getRecentHistory(50);
				setResults(items);
				setLoading(false);
			}
		}, 200);
		return () => clearTimeout(timer);
	}, [query]);

	// Open URL
	const handleClick = useCallback((url: string, e: React.MouseEvent) => {
		if (e.ctrlKey || e.metaKey) {
			chrome.tabs.create({ url });
		} else {
			chrome.tabs.update({ url });
		}
	}, []);

	// Delete
	const handleDelete = useCallback(async (url: string, e: React.MouseEvent) => {
		e.stopPropagation();
		await deleteHistoryItem(url);
		setResults((r) => r.filter((x) => x.url !== url));
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Search */}
			<input
				style={styles.search}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t('historySearch.placeholder')}
				autoFocus
			/>

			{/* Results */}
			<div style={styles.list}>
				{loading ? (
					<div style={styles.empty}>⏳ {t('historySearch.loading')}</div>
				) : results.length === 0 ? (
					<div style={styles.empty}>📜 {t('historySearch.noResults')}</div>
				) : (
					results.map((item) => (
						<div key={item.id} style={styles.item} onClick={(e) => handleClick(item.url, e)}>
							<img src={getFaviconUrl(item.url)} alt="" style={styles.favicon} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
							<div style={styles.info}>
								<div style={styles.title}>{item.title || item.url}</div>
								<div style={styles.url}>{item.url}</div>
							</div>
							<div style={styles.meta}>
								<span style={styles.visits}>{item.visitCount}×</span>
								<span style={styles.time}>{formatTimeAgo(item.lastVisitTime)}</span>
								<button style={styles.btn} onClick={(e) => handleDelete(item.url, e)}>🗑️</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
};
