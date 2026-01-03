// goal: Interface settings section with Drag-and-Drop
// eff: Split from SettingsPanel

import React, { useState } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HaloSettings, IconSize } from '../../kernel';
import { getToolMeta } from '../../kernel';
import { styles } from './panel.styles';

interface InterfaceSettingsProps {
	settings: HaloSettings;
	onUpdate: <K extends keyof HaloSettings>(key: K, value: HaloSettings[K]) => void;
}

const ALL_HEADER_TOOLS = ['module-store', 'extension-manager', 'permissions', 'settings', 'userscripts'];

export const InterfaceSettings: React.FC<InterfaceSettingsProps> = ({ settings, onUpdate }) => {
	const { t } = useTranslation();
	const [draggedItem, setDraggedItem] = useState<string | null>(null);

	// Force 'settings' to be always active
	const rawActive = settings.headerLayout || [];
	const activeTools = rawActive.includes('settings') ? rawActive : [...rawActive, 'settings'];
	const inactiveTools = ALL_HEADER_TOOLS.filter(id => !activeTools.includes(id));

	const handleDragStart = (e: React.DragEvent, id: string) => {
		setDraggedItem(id);
		e.dataTransfer.effectAllowed = 'move';
		// Adding a slight opacity to the drag image would be nice but default is okay
	};

	const handleDragOver = (e: React.DragEvent, targetId: string) => {
		e.preventDefault();
		if (!draggedItem || draggedItem === targetId) return;

		const currentIndex = activeTools.indexOf(draggedItem);
		const targetIndex = activeTools.indexOf(targetId);

		if (currentIndex !== -1 && targetIndex !== -1) {
			const newLayout = [...activeTools];
			newLayout.splice(currentIndex, 1);
			newLayout.splice(targetIndex, 0, draggedItem);
			onUpdate('headerLayout', newLayout);
		}
	};

	const handleToggle = (id: string, checked: boolean) => {
		if (checked) {
			// Add to layout: Insert BEFORE 'settings' if 'settings' is present (to keep it last by default)
			// OR add to end if settings is missing (should not happen with new logic)
			const newLayout = [...activeTools];
			const settingsIndex = newLayout.indexOf('settings');
			
			if (settingsIndex !== -1) {
				newLayout.splice(settingsIndex, 0, id);
			} else {
				// Fallback: add to end (settings might be missing or dragged earlier)
				newLayout.push(id);
			}
			onUpdate('headerLayout', newLayout);
		} else {
			// Remove
			onUpdate('headerLayout', activeTools.filter(x => x !== id));
		}
	};

	const renderItem = (id: string, isActive: boolean) => {
		const meta = getToolMeta(id);
		const icon = meta?.icon || (id === 'userscripts' ? '📜' : '🧩'); // Fallback icon
		const isSettings = id === 'settings';

		return (
			<div
				key={id}
				style={{
					...styles.row,
					cursor: isActive ? 'grab' : 'default',
					opacity: draggedItem === id ? 0.5 : 1,
					border: draggedItem === id ? '1px dashed var(--halo-accent)' : 'none',
					padding: '8px',
					borderRadius: '6px',
					background: isActive ? 'var(--halo-bg-secondary)' : 'transparent',
					marginBottom: '4px'
				}}
				draggable={isActive}
				onDragStart={(e) => isActive && handleDragStart(e, id)}
				onDragOver={(e) => isActive && handleDragOver(e, id)}
				onDragEnd={() => setDraggedItem(null)}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					{isActive && <span style={{ cursor: 'grab', color: 'var(--halo-text-muted)' }}>⋮⋮</span>}
					<div style={styles.label}>
						<span style={{ marginRight: 8, fontSize: '16px' }}>{icon}</span>
						{meta ? t(`tools.${id}.name`) : id}
					</div>
				</div>
				<Toggle
					checked={isActive}
					disabled={isSettings} // Settings cannot be disabled
					onChange={(checked) => !isSettings && handleToggle(id, checked)}
				/>
			</div>
		);
	};

	return (
		<Card variant="default" padding="md">
			<div style={styles.section}>
				<span style={styles.sectionTitle}>⚙️ {t('settings.interface')}</span>

				{/* Show Tool Labels */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.showLabels')}</div>
						<div style={styles.sublabel}>{t('settings.showLabelsDesc')}</div>
					</div>
					<Toggle
						checked={settings.showToolLabels}
						onChange={(checked) => onUpdate('showToolLabels', checked)}
					/>
				</div>

				{/* Icon Size */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.iconSize')}</div>
						<div style={styles.sublabel}>{t('settings.iconSizeDesc')}</div>
					</div>
					<select
						style={styles.select}
						value={settings.iconSize || 'medium'}
						onChange={(e) => onUpdate('iconSize', e.target.value as IconSize)}
					>
						<option value="small">{t('settings.small')}</option>
						<option value="medium">{t('settings.medium')}</option>
						<option value="large">{t('settings.large')}</option>
					</select>
				</div>

				{/* Compact Mode */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.compactMode')}</div>
						<div style={styles.sublabel}>{t('settings.compactModeDesc')}</div>
					</div>
					<Toggle
						checked={settings.compactMode}
						onChange={(checked) => onUpdate('compactMode', checked)}
					/>
				</div>

				{/* Header Shortcuts */}
				<div style={{ ...styles.sectionTitle, marginTop: 16 }}>
					📌 {t('settings.headerShortcuts')}
					<span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '8px', opacity: 0.7 }}>
						{t('settings.dragToReorder', { defaultValue: '(Drag to reorder)' })}
					</span>
				</div>
				
				<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
					{/* Active Tools (Draggable) */}
					{activeTools.map(id => renderItem(id, true))}
					
					{/* Divider if needed */}
					{inactiveTools.length > 0 && <div style={{ height: '1px', background: 'var(--halo-border)', margin: '8px 0' }} />}

					{/* Inactive Tools */}
					{inactiveTools.map(id => renderItem(id, false))}
				</div>

			</div>
		</Card>
	);
};
