import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { useModuleManager } from '../../kernel/use-module-manager';
import { useRemoteRegistry } from '../../kernel/use-remote-registry';
import { ALL_MODULES, formatModuleSize } from '../../kernel/module-registry';
import { ModuleItem } from './module-item';

type ViewMode = 'installed' | 'available' | 'all' | 'updates';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
	title: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' },
	tabs: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
	tab: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
		cursor: 'pointer', border: 'none', background: 'var(--halo-bg-tertiary)',
		color: 'var(--halo-text-muted)', transition: 'all 0.15s',
	},
	tabActive: { background: 'var(--halo-accent)', color: '#fff' },
	tabUpdate: { background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
	list: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '10px',
		border: '1px solid var(--halo-border)', transition: 'all 0.15s',
	},
	icon: { fontSize: '24px', width: '40px', textAlign: 'center' },
	info: { flex: 1, minWidth: 0 },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)', display: 'flex', alignItems: 'center', gap: '6px' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', marginTop: '2px' },
	meta: { fontSize: '10px', color: 'var(--halo-text-muted)', marginTop: '4px', display: 'flex', gap: '8px' },
	btn: {
		padding: '8px 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s', minWidth: '80px',
	},
	btnInstall: { background: 'var(--halo-accent)', color: '#fff' },
	btnRefresh: { padding: '6px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	badge: { fontSize: '9px', padding: '2px 6px', borderRadius: '4px' },
	badgeUpdate: { background: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
	stats: { padding: '10px 12px', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
};

export const ModuleStorePanel: React.FC = () => {
	const { t } = useTranslation();
	const { loading, installedModules, availableModules, getStatus, install, uninstall, isCore } = useModuleManager();
	const { loading: remoteLoading, hasUpdates, updates, refresh } = useRemoteRegistry();
	const [view, setView] = useState<ViewMode>('all');
	const [installing, setInstalling] = useState<string | null>(null);

	const handleInstall = useCallback(async (id: string) => {
		setInstalling(id);
		try { await install(id); } finally { setInstalling(null); }
	}, [install]);

	const handleUninstall = useCallback(async (id: string) => {
		await uninstall(id);
	}, [uninstall]);

	const handleRefresh = useCallback(async () => {
		await refresh();
	}, [refresh]);

	const displayModules = view === 'installed' ? installedModules
		: view === 'available' ? availableModules
		: ALL_MODULES;

	const totalInstalled = installedModules.length;
	const totalSize = installedModules.reduce((sum, m) => sum + m.size, 0);

	if (loading) {
		return (
			<Card variant="default" padding="md">
				<div style={styles.empty}>⏳ {t('moduleStorePanel.loading')}</div>
			</Card>
		);
	}

	return (
		<div style={styles.wrapper}>
			<div style={styles.header}>
				<span style={styles.title}>🧩 {t('moduleStorePanel.title')}</span>
				<div style={styles.tabs}>
					{(['all', 'installed', 'available'] as ViewMode[]).map((v) => (
						<button
							key={v}
							style={{ ...styles.tab, ...(view === v ? styles.tabActive : {}) }}
							onClick={() => setView(v)}
						>
							{v === 'all' ? t('moduleStorePanel.all') : v === 'installed' ? `${t('moduleStorePanel.installed')} (${totalInstalled})` : `${t('moduleStorePanel.available')} (${availableModules.length})`}
						</button>
					))}
					{hasUpdates && (
						<button
							style={{ ...styles.tab, ...(view === 'updates' ? styles.tabActive : styles.tabUpdate) }}
							onClick={() => setView('updates')}
						>
							🔄 {t('moduleStorePanel.updates')} ({updates.length})
						</button>
					)}
				</div>
			</div>

			<div style={styles.stats}>
				<span>📦 {totalInstalled} {t('moduleStorePanel.statsModules')} • 💾 {formatModuleSize(totalSize)}</span>
				<button style={styles.btnRefresh} onClick={handleRefresh} disabled={remoteLoading}>
					{remoteLoading ? '⏳' : '🔄'} {t('moduleStorePanel.checkUpdates')}
				</button>
			</div>

			{view === 'updates' && updates.length > 0 && (
				<Card variant="default" padding="sm">
					<div style={styles.list}>
						{updates.map((upd) => (
							<div key={upd.id} style={styles.item}>
								<span style={styles.icon as React.CSSProperties}>📦</span>
								<div style={styles.info}>
									<div style={styles.name}>
										{upd.id}
										<span style={{ ...styles.badge, ...styles.badgeUpdate }}>{t('moduleStorePanel.update')}</span>
									</div>
									<div style={styles.desc}>v{upd.currentVersion} → v{upd.newVersion}</div>
									{upd.changelog && <div style={styles.meta}>{upd.changelog}</div>}
								</div>
								<button style={{ ...styles.btn, ...styles.btnInstall }}>{t('moduleStorePanel.update')}</button>
							</div>
						))}
					</div>
				</Card>
			)}

			{view !== 'updates' && (
				<Card variant="default" padding="sm">
					<div style={styles.list}>
						{displayModules.length > 0 ? (
							displayModules.map((mod) => (
								<ModuleItem
									key={mod.id}
									module={mod}
									status={installing === mod.id ? 'downloading' : getStatus(mod.id)}
									isCore={isCore(mod.id)}
									onInstall={() => handleInstall(mod.id)}
									onUninstall={() => handleUninstall(mod.id)}
								/>
							))
						) : (
							<div style={styles.empty}>
								{view === 'available' ? `✅ ${t('moduleStorePanel.allInstalled')}` : t('moduleStorePanel.noModules')}
							</div>
						)}
					</div>
				</Card>
			)}
		</div>
	);
};
