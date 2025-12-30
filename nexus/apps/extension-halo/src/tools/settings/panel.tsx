// goal: Settings panel UI component with i18n support

import React, { useState, useCallback, useEffect } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation, type Locale } from '../../i18n';
import type { HaloSettings, ThemeMode } from '../../kernel/settings';
import { ACCENT_COLORS, DEFAULT_SETTINGS } from '../../kernel/settings';
import { loadSettings, saveSettings, getThemeColors, applyTheme } from '../../kernel/theme';

const logger = createLogger('Settings', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '16px',
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: '14px',
	},
	sectionTitle: {
		fontSize: '11px',
		fontWeight: 600,
		color: 'var(--halo-text-muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},
	row: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: '10px 0',
	},
	label: {
		fontSize: '13px',
		color: 'var(--halo-text)',
	},
	sublabel: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		marginTop: '4px',
	},
	themeGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(3, 1fr)',
		gap: '10px',
	},
	themeBtn: {
		padding: '14px 10px',
		border: '2px solid var(--halo-border)',
		borderRadius: '12px',
		background: 'var(--halo-bg-secondary)',
		color: 'var(--halo-text)',
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'all 0.2s',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '6px',
	},
	themeBtnActive: {
		borderColor: 'var(--halo-accent)',
		background: 'var(--halo-bg-tertiary)',
		boxShadow: '0 0 0 2px rgba(124, 58, 237, 0.2)',
	},
	colorGrid: {
		display: 'flex',
		gap: '10px',
		flexWrap: 'wrap',
	},
	colorSwatch: {
		width: '36px',
		height: '36px',
		borderRadius: '10px',
		cursor: 'pointer',
		border: '3px solid transparent',
		transition: 'transform 0.15s, border-color 0.2s, box-shadow 0.2s',
		boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
	},
	colorSwatchActive: {
		borderColor: 'var(--halo-text)',
		transform: 'scale(1.15)',
		boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
	},
	select: {
		padding: '10px 14px',
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		color: 'var(--halo-text)',
		fontSize: '12px',
		minWidth: '130px',
		outline: 'none',
	},
	resetBtn: {
		padding: '12px 18px',
		background: 'transparent',
		border: '1px solid var(--halo-border)',
		borderRadius: '10px',
		color: 'var(--halo-text-secondary)',
		fontSize: '12px',
		fontWeight: 500,
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '8px',
	},
	version: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		textAlign: 'center',
		padding: '14px 0',
	},
	toast: {
		position: 'fixed',
		bottom: '60px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		background: 'var(--halo-accent)',
		borderRadius: '24px',
		fontSize: '12px',
		fontWeight: 500,
		color: '#fff',
		zIndex: 1000,
		boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
		animation: 'fadeInUp 0.3s ease-out',
	},
};

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
									onClick={() => updateSetting('theme', mode)}
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
									onClick={() => updateSetting('accentColor', color.value)}
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

			{/* Interface */}
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
							onChange={(checked) => updateSetting('compactMode', checked)}
						/>
					</div>

					<div style={styles.row}>
						<div>
							<div style={styles.label}>{t('settings.showLabels')}</div>
							<div style={styles.sublabel}>{t('settings.showLabelsDesc')}</div>
						</div>
						<Toggle
							checked={settings.showToolLabels}
							onChange={(checked) => updateSetting('showToolLabels', checked)}
						/>
					</div>

					<div style={styles.row}>
						<div>
							<div style={styles.label}>{t('settings.animations')}</div>
							<div style={styles.sublabel}>{t('settings.animationsDesc')}</div>
						</div>
						<Toggle
							checked={settings.animationsEnabled}
							onChange={(checked) => updateSetting('animationsEnabled', checked)}
						/>
					</div>
				</div>
			</Card>

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
