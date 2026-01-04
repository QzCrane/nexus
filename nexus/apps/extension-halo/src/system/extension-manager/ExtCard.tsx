// goal: Extension card component
// eff: Single extension display with toggle, permissions view, and actions

import React, { useState } from 'react';
import { Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ExtensionInfo, ExtensionGroup } from './types';
import { DEFAULT_GROUPS } from './types';
import { toggleExtension, openOptionsPage, openDetailsPage, getExtensionIcon, launchExtension } from './core';
import { styles } from './panel.styles';

interface ExtCardProps {
	ext: ExtensionInfo;
	group?: ExtensionGroup;
	onToggle: () => void;
	onAssignGroup: (extId: string, group: ExtensionGroup | '') => void;
}

const GROUP_COLORS: Record<ExtensionGroup, string> = {
	dev: '#3b82f6',
	work: '#8b5cf6',
	entertainment: '#ec4899',
	other: '#6b7280',
};

export const ExtCard: React.FC<ExtCardProps> = ({ ext, group, onToggle, onAssignGroup }) => {
	const { t } = useTranslation();
	const [showPerms, setShowPerms] = useState(false);
	const iconUrl = getExtensionIcon(ext, 32);
	const hasOptions = !!ext.optionsUrl;
	const permCount = ext.permissions.length + ext.hostPermissions.length;

	const handleToggle = async () => {
		await toggleExtension(ext);
		onToggle();
	};

	const handleLaunch = () => launchExtension(ext);

	return (
		<div style={{ ...styles.extCard, ...(ext.enabled ? {} : styles.extCardDisabled), flexDirection: 'column', alignItems: 'stretch' }}>
			{/* Main Row */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
				{iconUrl ? (
					<img src={iconUrl} alt="" style={styles.extIcon} onClick={handleLaunch} title={t('extMgr.launch')} />
				) : (
					<div 
						style={{ ...styles.extIcon, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', background: 'var(--halo-bg-tertiary)', cursor: 'pointer' }}
						onClick={handleLaunch}
						title={t('extMgr.launch')}
					>🧩</div>
				)}
				
				<div style={styles.extInfo}>
					<div style={styles.extName}>{ext.name}</div>
					<div style={styles.extDesc}>{ext.description || '--'}</div>
					<div style={styles.extMeta}>
						<span>v{ext.version}</span>
						{group && (
							<span style={{ ...styles.groupBadge, background: `${GROUP_COLORS[group]}20`, color: GROUP_COLORS[group] }}>
								{DEFAULT_GROUPS[group].icon} {t(DEFAULT_GROUPS[group].label)}
							</span>
						)}
						{permCount > 0 && (
							<button 
								style={{ ...styles.permBadge, cursor: 'pointer', border: 'none' }} 
								onClick={() => setShowPerms(!showPerms)}
								title={t('extMgr.viewPermissions')}
							>
								🔒 {permCount} {t('extMgr.permissions')}
							</button>
						)}
					</div>
				</div>
				
				<div style={styles.extActions}>
					{/* Group Dropdown with Text */}
					<select
						style={{ ...styles.actionBtn, cursor: 'pointer', minWidth: '100px', textAlign: 'left' }}
						value={group || ''}
						onChange={(e) => onAssignGroup(ext.id, e.target.value as ExtensionGroup | '')}
						title={t('extMgr.assignGroup')}
					>
						<option value="">📂 {t('extMgr.noGroup')}</option>
						{Object.entries(DEFAULT_GROUPS).map(([k, v]) => (
							<option key={k} value={k}>{v.icon} {t(v.label)}</option>
						))}
					</select>
					
					{hasOptions && (
						<button style={styles.actionBtn} onClick={() => openOptionsPage(ext)} title={t('extMgr.openOptions')}>
							⚙️
						</button>
					)}
					<button style={styles.actionBtn} onClick={() => openDetailsPage(ext.id)} title={t('extMgr.details')}>
						🔗
					</button>
					
					{ext.mayDisable && (
						<Toggle checked={ext.enabled} onChange={handleToggle} />
					)}
				</div>
			</div>

			{/* Permissions Panel (Collapsible) */}
			{showPerms && permCount > 0 && (
				<div style={{ 
					marginTop: '8px', padding: '8px', borderRadius: '6px', 
					background: 'var(--halo-bg-tertiary)', fontSize: '11px', color: 'var(--halo-text-muted)'
				}}>
					{ext.permissions.length > 0 && (
						<div style={{ marginBottom: '4px' }}>
							<strong>{t('extMgr.permissions')}:</strong> {ext.permissions.join(', ')}
						</div>
					)}
					{ext.hostPermissions.length > 0 && (
						<div>
							<strong>{t('extMgr.hostPermissions')}:</strong> {ext.hostPermissions.slice(0, 5).join(', ')}
							{ext.hostPermissions.length > 5 && ` +${ext.hostPermissions.length - 5}`}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
