// goal: Settings panel UI component with i18n support
// eff: Split into sub-components for better maintainability

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import {
	buildLocalDiagnosticBundle,
	createDiagnosticEventBuffer,
	createLogger,
	downloadLocalDiagnosticBundle,
	installUnhandledDiagnosticEvents,
} from '@nexus/kernel';
import { useTranslation, type Locale, detectLocale, LOCALES } from '../../i18n';
import type { HaloSettings } from '../../kernel';
import { DEFAULT_SETTINGS } from '../../kernel';
import { loadSettings, saveSettings, getThemeColors, applyTheme } from '../../kernel';
import { styles } from './panel.styles';
import { useOverlay } from '../../components/ui/overlay';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { AppearanceSettings } from './AppearanceSettings';
import { InterfaceSettings } from './InterfaceSettings';

const logger = createLogger('Settings', 'HALO');

export interface SettingsPanelProps {
	onSettingsChange?: (settings: HaloSettings) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onSettingsChange }) => {
	const { t, setting, setLocale } = useTranslation();
	const { showToast } = useOverlay();
	const { activeServices, bgToolIds } = useActiveServices();
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [diagnosticEvents] = useState(() => createDiagnosticEventBuffer());
	const manifestVersion = chrome.runtime.getManifest().version;

	useEffect(() => {
		loadSettings().then(setSettings);
	}, []);

	useEffect(() => installUnhandledDiagnosticEvents(diagnosticEvents, 'settings'), [diagnosticEvents]);

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
		const newSetting = e.target.value as Locale | 'system';
		setLocale(newSetting);
		logger.info('Language changed to:', newSetting);
	}, [setLocale]);

	const handleReset = useCallback(async () => {
		const updated = await saveSettings(DEFAULT_SETTINGS);
		setSettings(updated);
		const colors = getThemeColors(updated.theme, updated.accentColor);
		applyTheme(colors);
		onSettingsChange?.(updated);
		showToast({ message: `${t('settings.resetAll')} ✓`, type: 'success' });
	}, [onSettingsChange, showToast, t]);

	const handleDiagnostics = useCallback(async () => {
		try {
			const bundle = await buildLocalDiagnosticBundle({
				product: 'HALO',
				owners: {
					activeServiceCount: activeServices.size,
					backgroundMechanismCount: bgToolIds.length,
					settingsSurfaceActive: true,
				},
				events: diagnosticEvents,
			});
			diagnosticEvents.record('info', 'settings', 'diagnostic-exported');
			downloadLocalDiagnosticBundle(bundle);
			showToast({
				message: t('settings.diagnosticsExported', {
					defaultValue: 'Diagnostic JSON exported locally. No data was sent.',
				}),
				type: 'success',
			});
		} catch {
			diagnosticEvents.record('error', 'settings', 'diagnostic-export-failed');
			showToast({
				message: t('settings.diagnosticsFailed', { defaultValue: 'Diagnostic export failed.' }),
				type: 'error',
			});
		}
	}, [activeServices.size, bgToolIds.length, diagnosticEvents, showToast, t]);

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
							value={setting} 
							onChange={handleLanguageChange}
						>
							<option value="system">
								{LOCALES[detectLocale()].common.system || t('common.system')}
							</option>
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
					
					<button type="button" style={styles.resetBtn} onClick={handleReset}>
						↻ {t('settings.resetAll')}
					</button>
					<button type="button" style={styles.resetBtn} onClick={() => void handleDiagnostics()}>
						🧪 {t('settings.exportDiagnostics', { defaultValue: 'Export diagnostic JSON' })}
					</button>
					<div style={styles.sublabel}>
						{t('settings.diagnosticsPrivacy', {
							defaultValue: 'Local-only redacted snapshot; excludes URLs, titles, storage values and secrets.',
						})}
					</div>
				</div>
			</Card>

			{/* Version */}
			<div style={styles.version}>
				HALO v{manifestVersion} • {t('settings.version')}
			</div>

		</div>
	);
};