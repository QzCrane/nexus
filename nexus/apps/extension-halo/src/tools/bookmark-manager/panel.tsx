// goal: Bookmark Manager panel UI - search and manage bookmarks

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { BookmarkSearchResult } from './types';
import { searchBookmarks, getRecentBookmarks, deleteBookmark, openBookmark, getFaviconUrl } from './core';
import { styles } from './panel.styles';
import { useToolState, usePermission } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


type ViewMode = 'search' | 'recent';
const viewModeCodec: ToolStateCodec<ViewMode> = {
	decode: (value) => value === 'search' || value === 'recent' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Bookmark view mode is invalid.' },
	encode: (value) => value,
};

export const BookmarkManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { hasPermission, request } = usePermission('bookmarks');
	const [mode, setMode, , modeRecovery] = useToolState<ViewMode>('bookmark-mode', 'recent', { codec: viewModeCodec });
	const [query, setQuery] = useToolState<string>('bookmark-query', '');

	const [results, setResults] = useState<BookmarkSearchResult[]>([]);
	const task = useOwnedAsyncTask();

	// Load recent on mount
	useEffect(() => {
		if (hasPermission !== false && mode === 'recent') {
			void task.run(() => getRecentBookmarks(30)).then((outcome) => {
				if (outcome.kind === 'succeeded') setResults(outcome.value);
			});
		}
		return task.cancel;
	}, [mode, hasPermission, task.run, task.cancel]);

	// Search bookmarks
	useEffect(() => {
		if (hasPermission !== false && mode === 'search' && query.length >= 2) {
			const timer = setTimeout(() => {
				void task.run(() => searchBookmarks(query)).then((outcome) => {
					if (outcome.kind === 'succeeded') setResults(outcome.value);
				});
			}, 200);
			return () => { clearTimeout(timer); task.cancel(); };
		} else if (hasPermission !== false && mode === 'search') {
			setResults([]);
		}
	}, [query, mode, hasPermission, task.run, task.cancel]);

	// Handle click
	const handleClick = useCallback((url: string, e: React.MouseEvent) => {
		openBookmark(url, e.ctrlKey || e.metaKey);
	}, []);

	// Handle delete
	const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		const outcome = await task.run(() => deleteBookmark(id));
		if (outcome.kind === 'succeeded') setResults((r) => r.filter((x) => x.id !== id));
	}, [task.run]);

	if (hasPermission === false) {
		return (
			<div style={{ ...styles.wrapper, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
				<StorageRecoveryActions recovery={modeRecovery} emptyValue="recent" exportName="halo-bookmark-mode-damaged.json" />
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
									transition: 'var(--halo-motion-transition, opacity 0.2s)'
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
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="recent" exportName="halo-bookmark-mode-damaged.json" />
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
				{task.phase === 'running' ? (
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
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}
		</div>
	);
};
