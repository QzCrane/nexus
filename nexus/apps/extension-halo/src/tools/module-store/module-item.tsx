// goal: Module item component for store list
// eff: Render individual module status and actions

import React from 'react';
import { useTranslation } from '../../i18n';
import { formatModuleSize, type ModuleMeta } from '../../kernel/module-registry';

const styles = {
	item: {
		display: 'flex', alignItems: 'center', gap: '16px', padding: '16px',
		background: 'var(--halo-bg-secondary)', borderRadius: '12px',
		border: '1px solid var(--halo-border)', transition: 'all 0.2s',
		minHeight: '72px'
	},
	icon: { fontSize: '24px', minWidth: '40px', textAlign: 'center', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', padding: '8px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
	info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
	name: { fontSize: '14px', fontWeight: 700, color: 'var(--halo-text)', display: 'flex', alignItems: 'center', gap: '8px' },
	desc: { fontSize: '12px', color: 'var(--halo-text-muted)', lineHeight: '1.4', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
	meta: { fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', gap: '8px', alignItems: 'center' },
	
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s', minWidth: '80px',
	},
	btnInstall: { background: 'var(--halo-accent)', color: '#fff' },
	btnUninstall: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)' },
	btnDownloading: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', cursor: 'wait' },
	btnCore: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', fontSize: '10px', cursor: 'default', padding: '4px 8px', borderRadius: '4px' },
	
	badge: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 },
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

	const nameKey = `tools.${module.id}.name`;
	const descKey = `tools.${module.id}.desc`;
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
					{!isCore && !isInstalled && <span style={{ ...styles.badge, ...styles.badgeNew }}>{t('moduleStorePanel.new')}</span>}
				</div>
				<div style={styles.desc} title={displayDesc}>{displayDesc}</div>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
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
				<div style={styles.meta}>
					<span>v{module.version}</span>
					<span>•</span>
					<span>{formatModuleSize(module.size)}</span>
				</div>
			</div>
		</div>
	);
};
