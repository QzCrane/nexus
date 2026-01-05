// goal: Extension manager panel
// eff: Main UI with filtering, grouping, and batch actions

import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { getToolMeta } from '../../kernel';
import { DEFAULT_GROUPS } from './types';
import type { ExtensionGroup } from './types';
import { ExtCard } from './ExtCard';
import { styles } from './panel.styles';
import { useOverlay } from '../../components/ui/overlay';
import { useExtensionManager } from './use-extension-manager';

type FilterType = 'all' | 'enabled' | 'disabled' | ExtensionGroup;

export const ExtensionManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showModal } = useOverlay();
	const meta = getToolMeta('extension-manager');
	const state = useExtensionManager();

	const handleBatchEnable = () => {
		const toEnable = state.filtered.filter(e => !e.enabled && e.mayDisable);
		if (toEnable.length === 0) return;
		showModal({
			type: 'confirm',
			title: t('extMgr.enableAll'),
			message: t('extMgr.confirmEnableAll', { count: toEnable.length }),
			onConfirm: () => state.batchEnable(toEnable)
		});
	};

	const handleBatchDisable = () => {
		const toDisable = state.filtered.filter(e => e.enabled && e.mayDisable);
		if (toDisable.length === 0) return;
		showModal({
			type: 'confirm',
			title: t('extMgr.disableAll'),
			message: t('extMgr.confirmDisableAll', { count: toDisable.length }),
			onConfirm: () => state.batchDisable(toDisable)
		});
	};

	const filters: { key: FilterType; label: string }[] = [
		{ key: 'all', label: t('extMgr.all') },
		{ key: 'enabled', label: t('extMgr.enabled') },
		{ key: 'disabled', label: t('extMgr.disabled') },
		...Object.entries(DEFAULT_GROUPS).map(([k, v]) => ({ key: k as FilterType, label: `${v.icon} ${t(v.label)}` })),
	];

	if (state.hasPermission === false) {
		return (
			<Card variant="default" padding="lg" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '16px' }}>
				<div style={{ fontSize: '48px' }}>{meta?.icon || '🔌'}</div>
				<h2 style={{ margin: 0 }}>{t('extMgr.permissionRequired')}</h2>
				<p style={{ margin: 0, opacity: 0.8, maxWidth: '300px' }}>{t('extMgr.permissionDesc')}</p>
				<button onClick={state.requestAccess} style={{ ...styles.batchBtn, background: 'var(--halo-accent)', color: '#fff', fontSize: '14px', padding: '8px 16px' }}>
					{t('extMgr.grantPermission')}
				</button>
			</Card>
		);
	}

	if (state.loading) return <div style={styles.emptyState}>⏳ {t('common.loading')}</div>;

	return (
		<Card variant="default" padding="none" style={{ height: '100%' }}>
			<div style={styles.container}>
				<div style={styles.header}>
					<input style={styles.searchInput} type="text" placeholder={t('extMgr.search')} value={state.search} onChange={(e) => state.setSearch(e.target.value)} />
				</div>

				<div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
					{filters.map(f => (
						<button key={f.key} style={{ ...styles.filterBtn, ...(state.filter === f.key ? styles.filterBtnActive : {}) }} onClick={() => state.setFilter(f.key)}>
							{f.label}
						</button>
					))}
				</div>

				<div style={styles.list} className="halo-scrollbar">
					{state.filtered.length > 0 ? (
						state.filtered.map(ext => (
							<ExtCard key={ext.id} ext={ext} group={state.getExtGroup(ext.id)} onToggle={state.loadData} onAssignGroup={state.handleAssignGroup} />
						))
					) : (
						<div style={styles.emptyState}>
							<span style={{ fontSize: '32px' }}>🔍</span>
							<span>{t('common.noResults')}</span>
						</div>
					)}
				</div>

				{state.filtered.length > 0 && (
					<div style={styles.batchActions}>
						<button style={styles.batchBtn} onClick={handleBatchEnable}>{t('extMgr.enableAll')}</button>
						<button style={{ ...styles.batchBtn, background: '#ef4444' }} onClick={handleBatchDisable}>{t('extMgr.disableAll')}</button>
						<span style={{ flex: 1 }} />
						<span style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{state.filtered.length} {t('common.tools')}</span>
					</div>
				)}
			</div>
		</Card>
	);
};
