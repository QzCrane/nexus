// goal: Appearance settings section
// eff: Split from SettingsPanel

import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HaloSettings, ThemeMode } from '../../kernel';
import { ACCENT_COLORS } from '../../kernel';
import { styles } from './panel.styles';

interface AppearanceSettingsProps {
	settings: HaloSettings;
	onUpdate: <K extends keyof HaloSettings>(key: K, value: HaloSettings[K]) => void;
}

export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({ settings, onUpdate }) => {
	const { t } = useTranslation();

	return (
		<Card variant="default" padding="md">
			<div style={styles.section}>
				<span style={styles.sectionTitle}>🎨 {t('settings.appearance')}</span>
				
				<div>
					<div style={styles.label}>{t('settings.theme')}</div>
					<div style={{ ...styles.sublabel, marginBottom: '10px' }}>
						{t('settings.themeDesc')}
					</div>
					<div style={styles.themeGrid}>
						{(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => (
							<button
								key={mode}
								onClick={() => onUpdate('theme', mode)}
								style={{
									...styles.themeBtn,
									...(settings.theme === mode ? styles.themeBtnActive : {}),
								}}
							>
								<span style={{ fontSize: '20px' }}>
									{mode === 'dark' ? '🌙' : mode === 'light' ? '☀️' : '💻'}
								</span>
								<span>{t(`settings.${mode}`)}</span>
							</button>
						))}
					</div>
				</div>

				<div>
					<div style={styles.label}>{t('settings.accentColor')}</div>
					<div style={{ ...styles.sublabel, marginBottom: '10px' }}>
						{t('settings.accentColorDesc')}
					</div>
					<div style={styles.colorGrid}>
						{ACCENT_COLORS.map((color) => (
							<div
								key={color.value}
								onClick={() => onUpdate('accentColor', color.value)}
								style={{
									...styles.colorSwatch,
									background: color.value,
									...(settings.accentColor === color.value ? styles.colorSwatchActive : {}),
								}}
								title={color.name}
							/>
						))}
					</div>
				</div>
			</div>
		</Card>
	);
};
