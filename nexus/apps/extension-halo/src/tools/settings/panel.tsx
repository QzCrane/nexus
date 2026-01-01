// goal: Settings panel UI component with i18n support
// eff: Split into sub-components for better maintainability

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation, type Locale } from '../../i18n';
import type { HaloSettings } from '../../kernel';
import { DEFAULT_SETTINGS } from '../../kernel';
import { loadSettings, saveSettings, getThemeColors, applyTheme } from '../../kernel';
import { styles } from './panel.styles';
import { AppearanceSettings } from './AppearanceSettings';
import { InterfaceSettings } from './InterfaceSettings';

const logger = createLogger('Settings', 'HALO');

interface SettingsPanelProps {
	onSettingsChange?: (settings: HaloSettings) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onSettingsChange }) => {
	const { t, locale, setLocale } = useTranslation();
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadSettings().then(setSettings);
	}, []);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const updateSetting = useCallback(async <K extends keyof HaloSettings>(
		key: K,
		value: HaloSettings[K]
	) => {
		const updated = await saveSettings({ [key]: value });
		setSettings(updated);
		
		// Apply theme changes immediately
		if (key === 'theme' || key === 'accentColor') {
			const colors = getThemeColors(updated.theme, updated.accentColor);
			applyTheme(colors);
		}
		
		onSettingsChange?.(updated);
		logger.info(`Setting updated: ${key}`, value);
	}, [onSettingsChange]);

	const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
		const newLocale = e.target.value as Locale;
		setLocale(newLocale);
		logger.info('Language changed to:', newLocale);
	}, [setLocale]);

	const handleReset = useCallback(async () => {
		const updated = await saveSettings(DEFAULT_SETTINGS);
		setSettings(updated);
		const colors = getThemeColors(updated.theme, updated.accentColor);
		applyTheme(colors);
		onSettingsChange?.(updated);
		showToast(t('settings.resetAll') + ' ✓');
	}, [onSettingsChange, showToast, t]);

	return (
		<div style={styles.wrapper}>
			{/* Appearance */}
			<AppearanceSettings settings={settings} onUpdate={updateSetting} />

			{/* Interface */}
			<InterfaceSettings settings={settings} onUpdate={updateSetting} />

			{/* Language */}
			<Card variant="default" padding="md">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>🌐 {t('common.language')}</span>
					
					<div style={styles.row}>
						<div>
							<div style={styles.label}>{t('settings.languageSetting')}</div>
							<div style={styles.sublabel}>{t('settings.languageSettingDesc')}</div>
						</div>
						<select 
							style={styles.select} 
							value={locale} 
							onChange={handleLanguageChange}
						>
							<option value="en">English</option>
							<option value="zh">简体中文</option>
						</select>
					</div>
				</div>
			</Card>

			{/* Actions */}
			<Card variant="default" padding="md">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>🔧 {t('settings.actions')}</span>
					
					<button style={styles.resetBtn} onClick={handleReset}>
						↻ {t('settings.resetAll')}
					</button>
				</div>
			</Card>

			{/* Version */}
			<div style={styles.version}>
				HALO v0.2.0 • {t('settings.version')}
			</div>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
