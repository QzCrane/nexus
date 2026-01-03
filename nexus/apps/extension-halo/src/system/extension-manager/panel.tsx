// goal: Extension manager panel
// eff: Main UI with filtering, grouping, and batch actions

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { getToolMeta } from '../../kernel';
import type { ExtensionInfo, ExtensionGroup } from './types';
import { DEFAULT_GROUPS } from './types';
import { getAllExtensions, loadGroups, assignToGroup, enableExtension, disableExtension } from './core';
import { ExtCard } from './ExtCard';
import { styles } from './panel.styles';

type FilterType = 'all' | 'enabled' | 'disabled' | ExtensionGroup;

export const ExtensionManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const meta = getToolMeta('extension-manager');
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);
	const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
	const [groups, setGroups] = useState<Record<ExtensionGroup, string[]>>({ dev: [], work: [], entertainment: [], other: [] });
	const [filter, setFilter] = useState<FilterType>('all');
	const [search, setSearch] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		chrome.permissions.contains({ permissions: ['management'] }, (granted) => {
			setHasPermission(granted);
			if (granted) setLoading(true);
			else setLoading(false);
		});
	}, []);

	const loadData = useCallback(async () => {
		if (!hasPermission) return;
		setLoading(true);
		const [exts, grps] = await Promise.all([getAllExtensions(), loadGroups()]);
		setExtensions(exts);
		setGroups(grps);
		setLoading(false);
	}, [hasPermission]);

	useEffect(() => { 
		if (hasPermission) loadData(); 
	}, [loadData, hasPermission]);

	// Listen for extension state changes
	useEffect(() => {
		if (!hasPermission) return;
		const listener = () => loadData();
		chrome.management?.onEnabled?.addListener(listener);
		chrome.management?.onDisabled?.addListener(listener);
		chrome.management?.onInstalled?.addListener(listener);
		chrome.management?.onUninstalled?.addListener(listener);
		return () => {
			chrome.management?.onEnabled?.removeListener(listener);
			chrome.management?.onDisabled?.removeListener(listener);
			chrome.management?.onInstalled?.removeListener(listener);
			chrome.management?.onUninstalled?.removeListener(listener);
		};
	}, [loadData, hasPermission]);

	const requestAccess = async () => {
		const granted = await chrome.permissions.request({ permissions: ['management'] });
		setHasPermission(granted);
		if (granted) loadData();
	};

	const getExtGroup = useCallback((id: string): ExtensionGroup | undefined => {
		for (const [g, ids] of Object.entries(groups)) {
			if (ids.includes(id)) return g as ExtensionGroup;
		}
		return undefined;
	}, [groups]);

	const filtered = useMemo(() => {
		let result = extensions;
		// Search filter
		if (search) {
			const q = search.toLowerCase();
			result = result.filter(e => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
		}
		// Type filter
		if (filter === 'enabled') result = result.filter(e => e.enabled);
		else if (filter === 'disabled') result = result.filter(e => !e.enabled);
		else if (['dev', 'work', 'entertainment', 'other'].includes(filter)) {
			result = result.filter(e => groups[filter as ExtensionGroup].includes(e.id));
		}
		return result.sort((a, b) => a.name.localeCompare(b.name));
	}, [extensions, search, filter, groups]);

	const handleAssignGroup = useCallback(async (extId: string, group: ExtensionGroup) => {
		const newGroups = await assignToGroup(extId, group, groups);
		setGroups(newGroups);
	}, [groups]);

	const handleBatchEnable = async () => {
		for (const ext of filtered.filter(e => !e.enabled && e.mayDisable)) {
			await enableExtension(ext.id);
		}
		loadData();
	};

	const handleBatchDisable = async () => {
		for (const ext of filtered.filter(e => e.enabled && e.mayDisable)) {
			await disableExtension(ext.id);
		}
		loadData();
	};

	const filters: { key: FilterType; label: string }[] = [
		{ key: 'all', label: t('extMgr.all') },
		{ key: 'enabled', label: t('extMgr.enabled') },
		{ key: 'disabled', label: t('extMgr.disabled') },
		...Object.entries(DEFAULT_GROUPS).map(([k, v]) => ({ key: k as FilterType, label: `${v.icon} ${t(v.label)}` })),
	];

	if (hasPermission === false) {
		return (
			<Card variant="default" padding="lg" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '16px' }}>
				<div style={{ fontSize: '48px' }}>{meta?.icon || '🔌'}</div>
				<h2 style={{ margin: 0 }}>{t('extMgr.permissionRequired') || 'Permission Required'}</h2>
				<p style={{ margin: 0, opacity: 0.8, maxWidth: '300px' }}>
					{t('extMgr.permissionDesc') || 'HALO needs permission to manage your extensions.'}
				</p>
				<button 
					onClick={requestAccess}
					style={{ ...styles.batchBtn, background: 'var(--halo-accent)', color: '#fff', fontSize: '14px', padding: '8px 16px' }}
				>
					{t('extMgr.grantPermission') || 'Grant Permission'}
				</button>
			</Card>
		);
	}

	if (loading) return <div style={styles.emptyState}>⏳ {t('common.loading')}</div>;

	return (
		<Card variant="default" padding="none" style={{ height: '100%' }}>
			<div style={styles.container}>
				{/* Header */}
				<div style={styles.header}>
					<input
						style={styles.searchInput}
						type="text"
						placeholder={t('extMgr.search')}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				{/* Filters */}
				<div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
					{filters.map(f => (
						<button
							key={f.key}
							style={{ ...styles.filterBtn, ...(filter === f.key ? styles.filterBtnActive : {}) }}
							onClick={() => setFilter(f.key)}
						>
							{f.label}
						</button>
					))}
				</div>

				{/* List */}
				<div style={styles.list} className="halo-scrollbar">
					{filtered.length > 0 ? (
						filtered.map(ext => (
							<ExtCard key={ext.id} ext={ext} group={getExtGroup(ext.id)} onToggle={loadData} onAssignGroup={handleAssignGroup} />
						))
					) : (
						<div style={styles.emptyState}>
							<span style={{ fontSize: '32px' }}>🔍</span>
							<span>{t('common.noResults')}</span>
						</div>
					)}
				</div>

				{/* Batch Actions */}
				{filtered.length > 0 && (
					<div style={styles.batchActions}>
						<button style={styles.batchBtn} onClick={handleBatchEnable}>{t('extMgr.enableAll')}</button>
						<button style={{ ...styles.batchBtn, background: '#ef4444' }} onClick={handleBatchDisable}>{t('extMgr.disableAll')}</button>
						<span style={{ flex: 1 }} />
						<span style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{filtered.length} {t('common.tools')}</span>
					</div>
				)}
			</div>
		</Card>
	);
};
