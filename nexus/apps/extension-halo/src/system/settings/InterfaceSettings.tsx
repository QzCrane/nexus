// goal: Interface settings section with Drag-and-Drop
// eff: Split from SettingsPanel

import React, { useState } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HaloSettings, IconSize } from '../../kernel';
import { getToolMeta } from '../../kernel';
import { styles } from './panel.styles';
import { HeaderLayoutConfig } from './components/header-layout-config';

interface InterfaceSettingsProps {
	settings: HaloSettings;
	onUpdate: <K extends keyof HaloSettings>(key: K, value: HaloSettings[K]) => void;
}

const ALL_HEADER_TOOLS = ['module-store', 'extension-manager', 'resource-monitor', 'permissions', 'settings', 'userscripts'];

export const InterfaceSettings: React.FC<InterfaceSettingsProps> = ({ settings, onUpdate }) => {
	const { t } = useTranslation();
	// Force 'settings' to be always active
	const rawActive = settings.headerLayout || [];
	const activeTools = rawActive.includes('settings') ? rawActive : [...rawActive, 'settings'];
	const inactiveTools = ALL_HEADER_TOOLS.filter(id => !activeTools.includes(id));

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
                
				{/* Show System Tools */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.showSystemTools', { defaultValue: 'Show System Tools' })}</div>
						<div style={styles.sublabel}>{t('settings.showSystemToolsDesc', { defaultValue: 'Show system tools in main page' })}</div>
					</div>
					<Toggle
						checked={settings.showSystemTools}
						onChange={(checked) => onUpdate('showSystemTools', checked)}
					/>
				</div>

				{/* Icon Size */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.iconSize')} ({typeof settings.iconSize === 'number' ? settings.iconSize: 24}px)</div>
						<div style={styles.sublabel}>{t('settings.iconSizeDesc')}</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>16px</span>
						<input
							type="range"
							min="16"
							max="48"
							step="2"
							value={typeof settings.iconSize === 'number' ? settings.iconSize : 24}
							onChange={(e) => onUpdate('iconSize', Number(e.target.value))}
							onWheel={(e) => {
								if (e.deltaY === 0) return;
								e.preventDefault();
								e.stopPropagation();
								const current = typeof settings.iconSize === 'number' ? settings.iconSize : 24;
								const delta = e.deltaY > 0 ? -2 : 2;
								const newVal = Math.min(Math.max(current + delta, 16), 48);
								if (newVal !== current) onUpdate('iconSize', newVal);
							}}
							style={{ width: '120px', cursor: 'e-resize' }}
						/>
						<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>48px</span>
					</div>
				</div>

				{/* Layout Spacing (formerly Compact Mode) */}
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('settings.spacing', { defaultValue: 'Spacing' })} ({settings.spacing ?? 12}px)</div>
						<div style={styles.sublabel}>{t('settings.spacingDesc', { defaultValue: 'Adjust layout density' })}</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{t('settings.tight', { defaultValue: 'Tight' })}</span>
						<input 
							type="range"
							min="4"
							max="24"
							step="2"
							value={settings.spacing ?? 12}
							onChange={(e) => onUpdate('spacing', Number(e.target.value))}
							onWheel={(e) => {
								if (e.deltaY === 0) return;
								e.preventDefault();
								e.stopPropagation();
								const current = settings.spacing ?? 12;
								const delta = e.deltaY > 0 ? -2 : 2;
								const newVal = Math.min(Math.max(current + delta, 4), 24);
								if (newVal !== current) onUpdate('spacing', newVal);
							}}
							style={{ width: '120px', cursor: 'e-resize' }}
						/>
						<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{t('settings.loose', { defaultValue: 'Loose' })}</span>
					</div>
				</div>

					{/* Header Shortcuts */}
				<HeaderLayoutConfig 
					activeTools={activeTools}
					inactiveTools={inactiveTools}
					onChange={(newLayout) => onUpdate('headerLayout', newLayout)}
				/>

			</div>
		</Card>
	);
};
