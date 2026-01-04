import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { getToolMeta } from '../../kernel';
import type { ExtensionInfo, ExtensionGroup } from './types';
import { getAllExtensions, loadGroups, assignToGroup, enableExtension, disableExtension } from './core';
import { ExtCard } from './ExtCard';
import { styles } from './panel.styles';
import { useOverlay, SearchInput } from '../../components/ui';
import { ExtensionFilter, FilterType } from './components/ExtensionFilter';
import { BatchActionToolbar } from './components/BatchActionToolbar';

import { useExtensionManager } from './hooks/use-extension-manager';

export const ExtensionManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showModal } = useOverlay();
	const meta = getToolMeta('extension-manager');
	
	const {
		hasPermission, loading, search, setSearch, filter, setFilter,
		filtered, disabledCount, enabledCount,
		loadData, requestAccess, getExtGroup, handleAssignGroup
	} = useExtensionManager();

	const handleBatchEnable = () => {
		if (disabledCount === 0) return;
		showModal({
			title: t('extMgr.confirmEnableTitle'),
			message: t('extMgr.confirmEnableDesc', { count: disabledCount }),
			type: 'confirm',
			onConfirm: async () => {
				const toEnable = filtered.filter(e => !e.enabled && e.mayDisable);
				for (const ext of toEnable) await enableExtension(ext.id);
				loadData();
			},
		});
	};

	const handleBatchDisable = () => {
		if (enabledCount === 0) return;
		showModal({
			title: t('extMgr.confirmDisableTitle'),
			message: t('extMgr.confirmDisableDesc', { count: enabledCount }),
			type: 'confirm',
			onConfirm: async () => {
				const toDisable = filtered.filter(e => e.enabled && e.mayDisable);
				for (const ext of toDisable) await disableExtension(ext.id);
				loadData();
			},
		});
	};

	if (hasPermission === false) {
		return (
			<Card variant="default" padding="lg" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '16px' }}>
				<div style={{ fontSize: '48px' }}>{meta?.icon || '🔌'}</div>
				<h2 style={{ margin: 0 }}>{t('extMgr.permissionRequired') || 'Permission Required'}</h2>
				<p style={{ margin: 0, opacity: 0.8, maxWidth: '300px' }}>
					{t('extMgr.permissionDesc') || 'HALO needs permission to manage your extensions.'}
				</p>
				<button onClick={requestAccess} style={{ ...styles.batchBtn, background: 'var(--halo-accent)', color: '#fff', fontSize: '14px', padding: '8px 16px' }}>
					{t('extMgr.grantPermission') || 'Grant Permission'}
				</button>
			</Card>
		);
	}

	if (loading) return <div style={styles.emptyState}>⏳ {t('common.loading')}</div>;

	return (
		<Card variant="default" padding="none" style={{ height: '100%' }}>
			<div style={styles.container}>
				<div style={styles.header}>
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder={t('extMgr.search')}
						enableShortcut
					/>
				</div>

				<ExtensionFilter currentFilter={filter} onFilterChange={setFilter} />

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

				{filtered.length > 0 && (
					<BatchActionToolbar
						disabledCount={disabledCount}
						enabledCount={enabledCount}
						totalCount={filtered.length}
						onBatchEnable={handleBatchEnable}
						onBatchDisable={handleBatchDisable}
					/>
				)}
			</div>
		</Card>
	);
};
