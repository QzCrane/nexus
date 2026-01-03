
import React from 'react';
import { useTranslation } from '../../i18n';
import { ALL_MODULES } from '../../kernel';
import { ModuleItem } from './module-item';
import { styles } from './panel.styles';

interface ModuleListProps {
	updates: any[];
	displayModules: typeof ALL_MODULES;
	installedModules: typeof ALL_MODULES;
	installingId: string | null;
	view: 'installed' | 'available' | 'all' | 'updates';
	handleInstall: (id: string) => void;
	handleUninstall: (m: typeof ALL_MODULES[0]) => void;
}

export const ModuleList: React.FC<ModuleListProps> = ({
	updates, displayModules, installedModules, installingId, view, handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	if (view === 'updates' && updates.length > 0) {
		return (
			<div style={styles.list}>
				{updates.map((upd) => (
					<div key={upd.id} style={styles.item}>
						<span style={styles.icon as React.CSSProperties}>📦</span>
						<div style={styles.info}>
							<div style={styles.name}>
								{t(`tools.${upd.id}.name`) === `tools.${upd.id}.name` ? upd.id : t(`tools.${upd.id}.name`)}
								<span style={{ ...styles.badge, ...styles.badgeUpdate }}>{t('moduleStorePanel.update')}</span>
							</div>
							<div style={styles.desc}>v{upd.currentVersion} → v{upd.newVersion}</div>
							{upd.changelog && <div style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{upd.changelog}</div>}
						</div>
						<button style={{ ...styles.btn, ...styles.btnInstall }}>{t('moduleStorePanel.update')}</button>
					</div>
				))}
			</div>
		);
	}

	return (
		<div style={styles.list}>
			{displayModules.length > 0 ? (
				displayModules.map((mod, index) => {
					const isInstalled = installedModules.some(m => m.id === mod.id);
					const loadingId = installingId;
					return (
						<ModuleItem
							key={mod.id}
							index={index + 1}
							module={mod}
							status={isInstalled ? (loadingId === mod.id ? 'updating' : 'installed') : (loadingId === mod.id ? 'downloading' : 'available')}
							isCore={!!(mod.builtIn && !mod.toolType)}
							onInstall={() => handleInstall(mod.id)}
							onUninstall={() => handleUninstall(mod)}
						/>
					);
				})
			) : (
				<div style={styles.empty}>
					<span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
					{view === 'available' ? t('moduleStorePanel.allInstalled') : t('moduleStorePanel.noModules')}
				</div>
			)}
		</div>
	);
};
