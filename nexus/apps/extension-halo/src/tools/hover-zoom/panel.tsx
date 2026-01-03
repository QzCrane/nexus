// goal: Hover zoom settings panel
// eff: Configure trigger, delay, anti-hotlink, position

import React, { useState, useEffect, useCallback } from 'react';
import { Toggle, Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { HoverZoomSettings, TriggerMode, Position, Background } from './types';
import { DEFAULT_SETTINGS, STORAGE_KEY, HOTLINK_DOMAINS } from './types';
import { enableAntiHotlink, disableAntiHotlink, isAntiHotlinkEnabled } from './engine';
import { styles } from './panel.styles';

export const HoverZoomPanel: React.FC = () => {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<HoverZoomSettings>(DEFAULT_SETTINGS);
	const [antiHotlinkActive, setAntiHotlinkActive] = useState(false);

	// Load settings
	useEffect(() => {
		(async () => {
			const result = await chrome.storage.local.get(STORAGE_KEY);
			if (result[STORAGE_KEY]) setSettings({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] });
			setAntiHotlinkActive(await isAntiHotlinkEnabled());
		})();
	}, []);

	// Save settings
	const updateSettings = useCallback(async (patch: Partial<HoverZoomSettings>) => {
		const newSettings = { ...settings, ...patch };
		setSettings(newSettings);
		await chrome.storage.local.set({ [STORAGE_KEY]: newSettings });
		
		// Handle anti-hotlink toggle
		if (patch.antiHotlink !== undefined) {
			if (patch.antiHotlink) {
				await enableAntiHotlink();
			} else {
				await disableAntiHotlink();
			}
			setAntiHotlinkActive(patch.antiHotlink);
		}
	}, [settings]);

	const triggers: { key: TriggerMode; label: string }[] = [
		{ key: 'hover', label: t('hoverZoom.triggerHover') },
		{ key: 'alt', label: t('hoverZoom.triggerAlt') },
		{ key: 'ctrl', label: t('hoverZoom.triggerCtrl') },
	];

	const positions: { key: Position; label: string }[] = [
		{ key: 'auto', label: t('hoverZoom.positionAuto') },
		{ key: 'left', label: t('hoverZoom.positionLeft') },
		{ key: 'right', label: t('hoverZoom.positionRight') },
	];

	const backgrounds: { key: Background; label: string }[] = [
		{ key: 'dark', label: t('hoverZoom.bgDark') },
		{ key: 'light', label: t('hoverZoom.bgLight') },
		{ key: 'blur', label: t('hoverZoom.bgBlur') },
	];

	return (
		<Card variant="default" padding="none" style={{ height: '100%' }}>
			<div style={styles.container} className="halo-scrollbar">
				{/* Enable Toggle */}
				<div style={styles.section}>
					<div style={styles.row}>
						<span style={styles.label}>{t('hoverZoom.enabled')}</span>
						<Toggle checked={settings.enabled} onChange={(v) => updateSettings({ enabled: v })} />
					</div>
				</div>

				{/* Trigger Mode */}
				<div style={styles.section}>
					<div style={styles.sectionTitle}>{t('hoverZoom.trigger')}</div>
					<div style={styles.segmented}>
						{triggers.map(tr => (
							<button
								key={tr.key}
								style={{ ...styles.segmentBtn, ...(settings.trigger === tr.key ? styles.segmentBtnActive : {}) }}
								onClick={() => updateSettings({ trigger: tr.key })}
							>{tr.label}</button>
						))}
					</div>
				</div>

				{/* Delay */}
				<div style={styles.section}>
					<div style={styles.row}>
						<span style={styles.label}>{t('hoverZoom.delay')}</span>
						<span style={styles.value}>{settings.delay}ms</span>
					</div>
					<input
						type="range"
						min={0}
						max={1000}
						step={50}
						value={settings.delay}
						onChange={(e) => updateSettings({ delay: Number(e.target.value) })}
						style={styles.slider}
					/>
				</div>

				{/* Max Size */}
				<div style={styles.section}>
					<div style={styles.row}>
						<span style={styles.label}>{t('hoverZoom.maxSize')}</span>
						<span style={styles.value}>{settings.maxSize}px</span>
					</div>
					<input
						type="range"
						min={200}
						max={1600}
						step={100}
						value={settings.maxSize}
						onChange={(e) => updateSettings({ maxSize: Number(e.target.value) })}
						style={styles.slider}
					/>
				</div>

				{/* Anti-Hotlink */}
				<div style={styles.section}>
					<div style={styles.row}>
						<div>
							<div style={styles.label}>{t('hoverZoom.antiHotlink')}</div>
							<div style={styles.description}>{t('hoverZoom.antiHotlinkDesc')}</div>
						</div>
						<Toggle checked={settings.antiHotlink} onChange={(v) => updateSettings({ antiHotlink: v })} />
					</div>
					{antiHotlinkActive && (
						<div style={styles.domainList}>
							{HOTLINK_DOMAINS.map(d => (
								<span key={d} style={styles.domainTag}>{d}</span>
							))}
						</div>
					)}
				</div>

				{/* Position */}
				<div style={styles.section}>
					<div style={styles.sectionTitle}>{t('hoverZoom.position')}</div>
					<div style={styles.segmented}>
						{positions.map(p => (
							<button
								key={p.key}
								style={{ ...styles.segmentBtn, ...(settings.position === p.key ? styles.segmentBtnActive : {}) }}
								onClick={() => updateSettings({ position: p.key })}
							>{p.label}</button>
						))}
					</div>
				</div>

				{/* Background */}
				<div style={styles.section}>
					<div style={styles.sectionTitle}>{t('hoverZoom.background')}</div>
					<div style={styles.segmented}>
						{backgrounds.map(b => (
							<button
								key={b.key}
								style={{ ...styles.segmentBtn, ...(settings.background === b.key ? styles.segmentBtnActive : {}) }}
								onClick={() => updateSettings({ background: b.key })}
							>{b.label}</button>
						))}
					</div>
				</div>
			</div>
		</Card>
	);
};
