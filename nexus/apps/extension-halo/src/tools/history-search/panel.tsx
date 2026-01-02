// goal: History Search panel UI - search and browse history

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HistoryItem } from './types';
import { searchHistory, deleteHistoryItem, getRecentHistory, formatTimeAgo, getFaviconUrl } from './core';
import { styles } from './panel.styles';
import { useToolState, usePermission } from '../../kernel';


export const HistorySearchPanel: React.FC = () => {
	const { t } = useTranslation();
	const { hasPermission, request } = usePermission('history');
	const [query, setQuery] = useToolState<string>('history-search' as any, '');

	const [results, setResults] = useState<HistoryItem[]>([]);
	const [loading, setLoading] = useState(true);

	// Load recent on mount
	useEffect(() => {
		if (hasPermission !== false) {
			getRecentHistory(50).then((items) => {
				setResults(items);
				setLoading(false);
			});
		}
	}, [hasPermission]);

	// Search on query change
	useEffect(() => {
		if (hasPermission === false) return;
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
	}, [query, hasPermission]);

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
							<button 
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
