// goal: Ruler tool panel UI with i18n support
// tradeoff: uses content script for on-page measurement overlay

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { RulerMeasurement } from './types';
import { formatValue, copyToClipboard, saveSettings, loadSettings } from './core';

const logger = createLogger('Ruler', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	startBtn: {
		width: '100%',
		padding: '14px 18px',
		background: 'linear-gradient(135deg, var(--halo-accent, #7c3aed), #4a9eff)',
		border: 'none',
		borderRadius: '12px',
		color: '#fff',
		fontSize: '14px',
		fontWeight: 600,
		cursor: 'pointer',
		transition: 'transform 0.1s, box-shadow 0.2s',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '8px',
	},
	activeBtn: {
		background: 'linear-gradient(135deg, #ef4444, #dc2626)',
	},
	optionsRow: {
		display: 'flex',
		gap: '12px',
		alignItems: 'center',
		fontSize: '12px',
		color: 'var(--halo-text-secondary, #888)',
	},
	select: {
		padding: '8px 12px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '8px',
		color: 'var(--halo-text, #ddd)',
		fontSize: '12px',
		outline: 'none',
	},
	input: {
		width: '60px',
		padding: '8px 10px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '8px',
		color: 'var(--halo-text, #ddd)',
		fontSize: '12px',
		textAlign: 'center',
		outline: 'none',
	},
	measurementCard: {
		background: 'var(--halo-bg-secondary, #1e1e1e)',
		borderRadius: '12px',
		padding: '18px',
		border: '1px solid var(--halo-border, #333)',
	},
	measureGrid: {
		display: 'grid',
		gridTemplateColumns: '1fr 1fr',
		gap: '16px',
	},
	measureItem: {
		display: 'flex',
		flexDirection: 'column',
		gap: '6px',
	},
	measureLabel: {
		fontSize: '10px',
		color: 'var(--halo-text-muted, #666)',
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
		fontWeight: 500,
	},
	measureValue: {
		fontSize: '20px',
		fontWeight: 600,
		color: 'var(--halo-text, #fff)',
		fontFamily: 'monospace',
		cursor: 'pointer',
		transition: 'color 0.15s',
	},
	diagonalRow: {
		marginTop: '12px',
		paddingTop: '14px',
		borderTop: '1px solid var(--halo-border, #333)',
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	hint: {
		fontSize: '12px',
		color: 'var(--halo-text-muted, #666)',
		textAlign: 'center',
		padding: '12px',
		background: 'var(--halo-bg-secondary, #1e1e1e)',
		borderRadius: '10px',
		lineHeight: '1.5',
	},
	ready: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '12px',
		padding: '24px',
		textAlign: 'center',
		color: 'var(--halo-text-muted, #666)',
	},
	readyIcon: {
		fontSize: '32px',
		opacity: 0.4,
	},
	toast: {
		position: 'fixed',
		bottom: '60px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '24px',
		fontSize: '12px',
		fontWeight: 500,
		color: '#fff',
		zIndex: 1000,
		boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
		animation: 'fadeInUp 0.3s ease-out',
	},
};

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
			// Cancel measurement
			await chrome.tabs.sendMessage(tab.id, { type: 'HALO_RULER_CANCEL' });
			setIsActive(false);
		} else {
			// Start measurement
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
		showToast(ok ? t('colorPanel.copied') : 'Copy failed');
	}, [showToast, t]);

	const widthStr = measurement ? formatValue(measurement.width, unit, remBase) : '-';
	const heightStr = measurement ? formatValue(measurement.height, unit, remBase) : '-';
	const diagStr = measurement ? formatValue(measurement.diagonal, unit, remBase) : '-';

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
					<span>Unit:</span>
					<select value={unit} onChange={handleUnitChange} style={styles.select}>
						<option value="px">Pixels (px)</option>
						<option value="rem">REM</option>
					</select>
					{unit === 'rem' && (
						<>
							<span>Base:</span>
							<input
								type="number"
								value={remBase}
								onChange={handleRemBaseChange}
								style={styles.input}
								min={1}
								max={32}
							/>
							<span>px</span>
						</>
					)}
				</div>
			</Card>

			{measurement && (
				<div style={styles.measurementCard}>
					<div style={styles.measureGrid}>
						<div style={styles.measureItem}>
							<span style={styles.measureLabel}>{t('rulerPanel.width')}</span>
							<span
								style={styles.measureValue}
								onClick={() => handleCopyValue(widthStr)}
								title="Click to copy"
							>
								{widthStr}
							</span>
						</div>
						<div style={styles.measureItem}>
							<span style={styles.measureLabel}>{t('rulerPanel.height')}</span>
							<span
								style={styles.measureValue}
								onClick={() => handleCopyValue(heightStr)}
								title="Click to copy"
							>
								{heightStr}
							</span>
						</div>
					</div>
					<div style={styles.diagonalRow}>
						<span style={{ ...styles.measureLabel, margin: 0 }}>{t('rulerPanel.diagonal')}</span>
						<span
							style={{ ...styles.measureValue, fontSize: '14px' }}
							onClick={() => handleCopyValue(diagStr)}
							title="Click to copy"
						>
							{diagStr}
						</span>
					</div>
				</div>
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
