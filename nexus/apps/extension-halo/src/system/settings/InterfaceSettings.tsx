// goal: Interface settings section
// eff: Split from SettingsPanel

import React from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HaloSettings, IconSize } from '../../kernel';
import { getToolMeta } from '../../kernel';
import { styles } from './panel.styles';

interface InterfaceSettingsProps {
	settings: HaloSettings;
	onUpdate: <K extends keyof HaloSettings>(key: K, value: HaloSettings[K]) => void;
}

export const InterfaceSettings: React.FC<InterfaceSettingsProps> = ({ settings, onUpdate }) => {
	const { t } = useTranslation();

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
				<div style={{...styles.sectionTitle, marginTop: 16}}>📌 {t('settings.headerShortcuts')}</div>
				{['module-store', 'extension-manager', 'permissions', 'settings', 'userscripts'].map(id => {
					const current = settings.headerLayout || ['module-store', 'extension-manager', 'settings', 'userscripts'];
					const isVisible = current.includes(id);
					const meta = getToolMeta(id);
					const icon = meta?.icon || (id === 'userscripts' ? '📜' : '🧩'); // Fallback icon

					return (
						<div style={styles.row} key={id}>
							<div>
								<div style={styles.label}>
									<span style={{marginRight: 8, fontSize: '16px'}}>{icon}</span>
									{meta ? t(`tools.${id}.name`) : id}
								</div>
							</div>
							<Toggle
								checked={isVisible}
								onChange={(checked) => {
									let next;
									if (checked) {
										if (!current.includes(id)) next = [...current, id];
										else next = current;
									} else {
										next = current.filter(x => x !== id);
									}
									onUpdate('headerLayout', next);
								}}
							/>
						</div>
					);
				})}

			</div>
		</Card>
	);
};
