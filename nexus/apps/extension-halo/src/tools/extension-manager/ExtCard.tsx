// goal: Extension card component
// eff: Single extension display with toggle and actions

import React from 'react';
import { Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ExtensionInfo, ExtensionGroup } from './types';
import { DEFAULT_GROUPS } from './types';
import { toggleExtension, openOptionsPage, openDetailsPage, getExtensionIcon } from './core';
import { styles } from './panel.styles';

interface ExtCardProps {
	ext: ExtensionInfo;
	group?: ExtensionGroup;
	onToggle: () => void;
	onAssignGroup: (extId: string, group: ExtensionGroup) => void;
}

const GROUP_COLORS: Record<ExtensionGroup, string> = {
	dev: '#3b82f6',
	work: '#8b5cf6',
	entertainment: '#ec4899',
	other: '#6b7280',
};

export const ExtCard: React.FC<ExtCardProps> = ({ ext, group, onToggle, onAssignGroup }) => {
	const { t } = useTranslation();
	const iconUrl = getExtensionIcon(ext, 32);
	const hasOptions = !!ext.optionsUrl;
	const permCount = ext.permissions.length + ext.hostPermissions.length;

	const handleToggle = async () => {
		await toggleExtension(ext);
		onToggle();
	};

	return (
		<div style={{ ...styles.extCard, ...(ext.enabled ? {} : styles.extCardDisabled) }}>
			{iconUrl ? (
				<img src={iconUrl} alt="" style={styles.extIcon} />
			) : (
				<div style={{ ...styles.extIcon, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', background: 'var(--halo-bg-tertiary)' }}>🧩</div>
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
						<span style={styles.permBadge}>{permCount} {t('extMgr.permissions')}</span>
					)}
				</div>
			</div>
			
			<div style={styles.extActions}>
				{/* Group Dropdown */}
				<select
					style={{ ...styles.actionBtn, cursor: 'pointer' }}
					value={group || ''}
					onChange={(e) => onAssignGroup(ext.id, e.target.value as ExtensionGroup)}
					title={t('extMgr.assignGroup')}
				>
					<option value="">📂</option>
					{Object.entries(DEFAULT_GROUPS).map(([k, v]) => (
						<option key={k} value={k}>{v.icon}</option>
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
	);
};
