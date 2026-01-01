// goal: Interface settings section
// eff: Split from SettingsPanel

import React from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HaloSettings } from '../../kernel';
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




			</div>
		</Card>
	);
};
