// goal: Module item component for store list
// eff: Render individual module status and actions

import React from 'react';
import { useTranslation } from '../../i18n';
import { formatModuleSize, type ModuleMeta } from '../../kernel/module-registry';

const styles = {
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
	btnUninstall: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)' },
	btnDownloading: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', cursor: 'wait' },
	btnCore: { background: 'transparent', color: 'var(--halo-text-muted)', fontSize: '10px', cursor: 'default' },
	badge: { fontSize: '9px', padding: '2px 6px', borderRadius: '4px' },
	badgeCore: { background: 'var(--halo-accent-alpha)', color: 'var(--halo-accent)' },
	badgeNew: { background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
};

interface ModuleItemProps {
	module: ModuleMeta;
	status: 'installed' | 'available' | 'downloading' | 'updating' | 'error';
	isCore: boolean;
	onInstall: () => void;
	onUninstall: () => void;
}

export const ModuleItem: React.FC<ModuleItemProps> = ({ module, status, isCore, onInstall, onUninstall }) => {
	const { t } = useTranslation();
	const isInstalled = status === 'installed';
	const isDownloading = status === 'downloading' || status === 'updating';

	const nameKey = `modules.tools.${module.id}.name`;
	const descKey = `modules.tools.${module.id}.desc`;
	const nameTranslation = t(nameKey);
	const descTranslation = t(descKey);
	
	const displayName = nameTranslation === nameKey ? module.name : nameTranslation;
	const displayDesc = descTranslation === descKey ? module.description : descTranslation;

	return (
		<div style={styles.item}>
			<span style={styles.icon as React.CSSProperties}>{module.icon}</span>
			<div style={styles.info}>
				<div style={styles.name}>
					{displayName}
					{isCore && <span style={{ ...styles.badge, ...styles.badgeCore }}>{t('moduleStorePanel.core')}</span>}
					{!isCore && !isInstalled && <span style={{ ...styles.badge, ...styles.badgeNew }}>{t('moduleStorePanel.new')}</span>}
				</div>
				<div style={styles.desc}>{displayDesc}</div>
				<div style={styles.meta}>
					<span>v{module.version}</span>
					<span>•</span>
					<span>{formatModuleSize(module.size)}</span>
				</div>
			</div>

			{isCore ? (
				<span style={styles.btnCore}>{t('moduleStorePanel.builtIn')}</span>
			) : isDownloading ? (
				<button style={{ ...styles.btn, ...styles.btnDownloading }} disabled>
					⏳ {status === 'updating' ? t('moduleStorePanel.updating') : t('moduleStorePanel.installing')}
				</button>
			) : isInstalled ? (
				<button style={{ ...styles.btn, ...styles.btnUninstall }} onClick={onUninstall}>
					{t('moduleStorePanel.uninstall')}
				</button>
			) : (
				<button style={{ ...styles.btn, ...styles.btnInstall }} onClick={onInstall}>
					{t('moduleStorePanel.install')}
				</button>
			)}
		</div>
	);
};
