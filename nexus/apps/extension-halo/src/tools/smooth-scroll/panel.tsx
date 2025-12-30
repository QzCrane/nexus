// goal: Smooth Scroll settings panel with full feature parity
// eff: Components extracted to separate files

import React, { useCallback, useRef } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, PROFILES, STORAGE_KEY } from './types';
import { broadcastSettings } from './core';
import { styles } from './panel.styles';
import { useSmoothScrollSettings } from './hooks';
import { ScrollParameters } from './ScrollParameters';

const logger = createLogger('SmoothScroll', 'HALO');

export const SmoothScrollPanel: React.FC = () => {
	const {
		settings,
		setSettings,
		toast,
		showToast,
		hasCustomProfile,
		updateSetting,
		loadProfile,
		loadCustomProfile,
		saveAsCustom,
		t,
	} = useSmoothScrollSettings();
	
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Config management
	const handleExport = useCallback(() => {
		const json = JSON.stringify(settings, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'halo-scroll-config.json';
		a.click();
		URL.revokeObjectURL(url);
		showToast(t('smoothScroll.toasts.exported'));
	}, [settings, showToast, t]);

	const handleImport = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const imported = JSON.parse(text) as Partial<ScrollSettings>;
			const validated: ScrollSettings = { ...DEFAULT_SETTINGS, ...imported };
			await chrome.storage.sync.set({ [STORAGE_KEY]: validated });
			setSettings(validated);
			await broadcastSettings(validated);
			showToast(t('smoothScroll.toasts.imported'));
			logger.info('Config imported from file');
		} catch (err) {
			showToast(t('smoothScroll.toasts.importFailed'));
			logger.error('Import error:', err);
		}
		e.target.value = '';
	}, [showToast, setSettings, t]);

	return (
		<div style={styles.wrapper}>
			{/* Master Toggle */}
			<Card variant="default" padding="md">
				<div style={styles.row}>
					<div>
						<div style={styles.label}>{t('smoothScroll.enable')}</div>
						<div style={styles.sublabel}>{t('smoothScroll.enableDesc')}</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
						<span style={{ ...styles.statusBadge, background: settings.enabled ? 'rgba(34. 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: settings.enabled ? '#22c55e' : '#ef4444' }}>
							{settings.enabled ? 'ON' : 'OFF'}
						</span>
						<Toggle checked={settings.enabled} onChange={(checked) => updateSetting('enabled', checked)} />
					</div>
				</div>
			</Card>

			{/* Profiles & Config Management */}
			<Card variant="default" padding="sm">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>📋 {t('smoothScroll.profiles')}</span>
					<div style={styles.profileRow}>
						{Object.keys(PROFILES).map((name) => (
							<button key={name} style={styles.profileBtn} onClick={() => loadProfile(name as keyof typeof PROFILES)}>
								{t(`smoothScroll.profilesList.${name}` as any)}
							</button>
						))}
						{hasCustomProfile && (
							<button style={{ ...styles.profileBtn, borderColor: 'var(--halo-accent)', color: 'var(--halo-accent)' }} onClick={loadCustomProfile}>
								⭐ {t('smoothScroll.profilesList.custom')}
							</button>
						)}
					</div>
					<div style={styles.mgmtRow}>
						<button style={{ ...styles.mgmtBtn, borderColor: 'var(--halo-accent)', color: 'var(--halo-accent)' }} onClick={saveAsCustom} title="Save current settings as Custom profile">
							💾 {t('smoothScroll.saveCustom')}
						</button>
						<button style={styles.mgmtBtn} onClick={handleExport} title="Export config as JSON">
							📤 {t('smoothScroll.export')}
						</button>
						<button style={styles.mgmtBtn} onClick={handleImport} title="Import config from JSON">
							📥 {t('smoothScroll.import')}
						</button>
					</div>
					<input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />
				</div>
			</Card>

			<ScrollParameters settings={settings} updateSetting={updateSetting} />

			{/* Input Sources */}
			<Card variant="default" padding="md">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>🖱️ {t('smoothScroll.inputSources')}</span>
					<div style={styles.row}><div style={styles.label}>{t('smoothScroll.mouseWheel')}</div><Toggle checked={settings.mouseWheel} onChange={(checked) => updateSetting('mouseWheel', checked)} disabled={!settings.enabled} /></div>
					<div style={styles.row}><div style={styles.label}>{t('smoothScroll.keyboard')}</div><Toggle checked={settings.keyboard} onChange={(checked) => updateSetting('keyboard', checked)} disabled={!settings.enabled} /></div>
					<div style={styles.row}><div style={styles.label}>{t('smoothScroll.touchpad')}</div><Toggle checked={settings.touchpad} onChange={(checked) => updateSetting('touchpad', checked)} disabled={!settings.enabled} /></div>
				</div>
			</Card>

			{/* Features */}
			<Card variant="default" padding="md">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>✨ {t('smoothScroll.features')}</span>
					<div style={styles.row}><div style={styles.label}>{t('smoothScroll.middleClickAutoScroll')}</div><Toggle checked={settings.middleClickAutoScroll} onChange={(checked) => updateSetting('middleClickAutoScroll', checked)} disabled={!settings.enabled} /></div>
					<div style={styles.row}><div style={styles.label}>{t('smoothScroll.fixedBackground')}</div><Toggle checked={settings.fixedBackground} onChange={(checked) => updateSetting('fixedBackground', checked)} disabled={!settings.enabled} /></div>
				</div>
			</Card>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
