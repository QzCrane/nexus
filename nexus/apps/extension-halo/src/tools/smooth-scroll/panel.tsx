// goal: Smooth Scroll settings panel with full feature parity

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, EASING_OPTIONS, PROFILES, STORAGE_KEY } from './types';
import { loadSettings, saveSettings, broadcastSettings } from './core';

const logger = createLogger('SmoothScroll', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '14px', scrollBehavior: 'smooth' },
	row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' },
	label: { fontSize: '12px', color: 'var(--halo-text)' },
	sublabel: { fontSize: '10px', color: 'var(--halo-text-muted)', marginTop: '2px' },
	select: { padding: '8px 12px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', minWidth: '100px', outline: 'none' },
	input: { width: '70px', padding: '6px 8px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '11px', textAlign: 'center' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	sectionTitle: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' },
	statusBadge: { padding: '3px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600 },
	profileRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
	profileBtn: { padding: '6px 12px', background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text-secondary)', fontSize: '10px', cursor: 'pointer', transition: 'all 0.15s' },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', background: 'var(--halo-accent)', borderRadius: '20px', fontSize: '11px', fontWeight: 500, color: '#fff', zIndex: 1000 },
	mgmtRow: { display: 'flex', gap: '8px', marginTop: '4px' },
	mgmtBtn: { flex: 1, padding: '8px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text-secondary)', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all 0.15s' },
	mgmtBtnDanger: { flex: 1, padding: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all 0.15s' },
};

export const SmoothScrollPanel: React.FC = () => {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<ScrollSettings>(DEFAULT_SETTINGS);
	const [toast, setToast] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => { loadSettings().then(setSettings); }, []);

	const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1200); }, []);

	const updateSetting = useCallback(async <K extends keyof ScrollSettings>(key: K, value: ScrollSettings[K]) => {
		const updated = await saveSettings({ [key]: value });
		setSettings(updated);
		await broadcastSettings(updated);
		logger.info(`Setting updated: ${key}`, value);
	}, []);

	const loadProfile = useCallback(async (profileName: keyof typeof PROFILES) => {
		const profile = PROFILES[profileName];
		const updated = await saveSettings(profile);
		setSettings(updated);
		await broadcastSettings(updated);
		showToast(`${profileName} loaded`);
	}, [showToast]);

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
		showToast('Config exported');
	}, [settings, showToast]);

	const handleImport = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const imported = JSON.parse(text) as Partial<ScrollSettings>;
			// Validate and merge with defaults
			const validated: ScrollSettings = { ...DEFAULT_SETTINGS, ...imported };
			await chrome.storage.sync.set({ [STORAGE_KEY]: validated });
			setSettings(validated);
			await broadcastSettings(validated);
			showToast('Config imported');
			logger.info('Config imported from file');
		} catch (err) {
			showToast('Import failed');
			logger.error('Import error:', err);
		}
		e.target.value = ''; // Reset for re-import
	}, [showToast]);

	const handleReset = useCallback(async () => {
		await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
		setSettings(DEFAULT_SETTINGS);
		await broadcastSettings(DEFAULT_SETTINGS);
		showToast('Reset to defaults');
		logger.info('Settings reset to defaults');
	}, [showToast]);

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

			{/* Profiles */}
			<Card variant="default" padding="sm">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>📋 {t('smoothScroll.loadProfile')}</span>
					<div style={styles.profileRow}>
						{Object.keys(PROFILES).map((name) => (
							<button key={name} style={styles.profileBtn} onClick={() => loadProfile(name as keyof typeof PROFILES)}>
								{name.charAt(0).toUpperCase() + name.slice(1)}
							</button>
						))}
					</div>
				</div>
			</Card>

			{/* Scroll Parameters */}
			<Card variant="default" padding="md">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>⚡ {t('smoothScroll.behavior')}</span>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.stepSize')}</div><div style={styles.sublabel}>px</div></div>
						<input type="number" value={settings.stepSize} onChange={(e) => updateSetting('stepSize', parseInt(e.target.value) || 100)} style={styles.input} disabled={!settings.enabled} min={10} max={500} />
					</div>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.animationTime')}</div><div style={styles.sublabel}>ms</div></div>
						<input type="number" value={settings.animationTime} onChange={(e) => updateSetting('animationTime', parseInt(e.target.value) || 400)} style={styles.input} disabled={!settings.enabled} min={50} max={2000} />
					</div>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.accelerationMax')}</div><div style={styles.sublabel}>x</div></div>
						<input type="number" value={settings.accelerationMax} onChange={(e) => updateSetting('accelerationMax', parseFloat(e.target.value) || 3)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
					</div>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.accelerationDelta')}</div><div style={styles.sublabel}>ms</div></div>
						<input type="number" value={settings.accelerationDelta} onChange={(e) => updateSetting('accelerationDelta', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={300} />
					</div>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.pulseScale')}</div><div style={styles.sublabel}>x</div></div>
						<input type="number" value={settings.pulseScale} onChange={(e) => updateSetting('pulseScale', parseFloat(e.target.value) || 4)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
					</div>

					<div style={styles.row}>
						<div><div style={styles.label}>{t('smoothScroll.arrowKeyStep')}</div><div style={styles.sublabel}>px</div></div>
						<input type="number" value={settings.arrowKeyStep} onChange={(e) => updateSetting('arrowKeyStep', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={200} />
					</div>

					<div style={styles.row}>
						<div style={styles.label}>{t('smoothScroll.easing')}</div>
						<select value={settings.easing} onChange={(e) => updateSetting('easing', e.target.value as ScrollSettings['easing'])} style={styles.select} disabled={!settings.enabled}>
							{EASING_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
						</select>
					</div>
				</div>
			</Card>

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

			{/* Config Management */}
			<Card variant="default" padding="sm">
				<div style={styles.section}>
					<span style={styles.sectionTitle}>⚙️ {t('smoothScroll.configMgmt') || 'Config Management'}</span>
					<div style={styles.mgmtRow}>
						<button style={styles.mgmtBtn} onClick={handleExport} title="Export config as JSON">
							📤 {t('smoothScroll.export') || 'Export'}
						</button>
						<button style={styles.mgmtBtn} onClick={handleImport} title="Import config from JSON">
							📥 {t('smoothScroll.import') || 'Import'}
						</button>
						<button style={styles.mgmtBtnDanger} onClick={handleReset} title="Reset to default settings">
							🔄 {t('smoothScroll.reset') || 'Reset'}
						</button>
					</div>
					<input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />
				</div>
			</Card>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
