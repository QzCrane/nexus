// goal: Ruler tool panel UI with i18n support
// eff: Styles and component extracted

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { RulerMeasurement } from './types';
import { copyToClipboard, saveSettings, loadSettings } from './core';
import { styles } from './panel.styles';
import { MeasurementCard } from './MeasurementCard';

const logger = createLogger('Ruler', 'HALO');

export const RulerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [isActive, setIsActive] = useState(false);
	const [measurement, setMeasurement] = useState<RulerMeasurement | null>(null);
	const [unit, setUnit] = useState<'px' | 'rem'>('px');
	const [remBase, setRemBase] = useState(16);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadSettings().then(({ unit: u, remBase: r }) => {
			setUnit(u);
			setRemBase(r);
		});

		// Listen for measurement results from content script
		const listener = (message: { type: string; data?: RulerMeasurement }): boolean | undefined => {
			if (message.type === 'HALO_RULER_RESULT' && message.data) {
				setMeasurement(message.data);
				setIsActive(false);
				logger.info('Measurement received:', message.data);
			}
			return undefined;
		};
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, []);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleToggle = useCallback(async () => {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return;

		if (isActive) {
			await chrome.tabs.sendMessage(tab.id, { type: 'HALO_RULER_CANCEL' });
			setIsActive(false);
		} else {
			await chrome.tabs.sendMessage(tab.id, { type: 'HALO_RULER_START' });
			setIsActive(true);
			logger.info('Ruler started');
		}
	}, [isActive]);

	const handleUnitChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
		const newUnit = e.target.value as 'px' | 'rem';
		setUnit(newUnit);
		await saveSettings({ unit: newUnit, remBase });
	}, [remBase]);

	const handleRemBaseChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = parseInt(e.target.value, 10) || 16;
		setRemBase(val);
		await saveSettings({ unit, remBase: val });
	}, [unit]);

	const handleCopyValue = useCallback(async (value: string) => {
		const ok = await copyToClipboard(value);
		showToast(ok ? t('rulerPanel.copied') : t('rulerPanel.copyFailed'));
	}, [showToast, t]);

	return (
		<div style={styles.wrapper}>
			<button
				style={{ ...styles.startBtn, ...(isActive ? styles.activeBtn : {}) }}
				onClick={handleToggle}
			>
				{isActive ? `⏹️ ${t('rulerPanel.cancel')}` : `📐 ${t('rulerPanel.start')}`}
			</button>

			{isActive && (
				<div style={styles.hint}>
					{t('rulerPanel.measuring')}
				</div>
			)}

			<Card variant="default" padding="sm">
				<div style={styles.optionsRow}>
					<span>{t('rulerPanel.unit')}</span>
					<select value={unit} onChange={handleUnitChange} style={styles.select}>
						<option value="px">{t('rulerPanel.pixels')}</option>
						<option value="rem">{t('rulerPanel.rem')}</option>
					</select>
					{unit === 'rem' && (
						<>
							<span>{t('rulerPanel.base')}</span>
							<input
								type="number"
								value={remBase}
								onChange={handleRemBaseChange}
								style={styles.input}
								min={1}
								max={32}
							/>
							<span>{t('smoothScroll.units.px')}</span>
						</>
					)}
				</div>
			</Card>

			{measurement && (
				<MeasurementCard
					measurement={measurement}
					unit={unit}
					remBase={remBase}
					onCopy={handleCopyValue}
				/>
			)}

			{!measurement && !isActive && (
				<div style={styles.ready}>
					<span style={styles.readyIcon}>📐</span>
					<span>{t('rulerPanel.ready')}</span>
				</div>
			)}

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
