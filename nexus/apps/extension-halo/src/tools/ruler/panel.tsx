// goal: Ruler tool panel UI with i18n support
// eff: Styles and component extracted

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { RulerMeasurement } from './types';
import { copyToClipboard } from './core';
import { styles } from './panel.styles';
import { MeasurementCard } from './MeasurementCard';
import { useToolState } from '../../kernel';
import { useToast } from '../../components/ToastProvider';


const logger = createLogger('Ruler', 'HALO');

export const RulerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [isActive, setIsActive] = useState(false);
	const [measurement, setMeasurement] = useState<RulerMeasurement | null>(null);
	const [unit, setUnit] = useToolState<'px' | 'rem'>('ruler-unit', 'px');
	const [remBase, setRemBase] = useToolState<number>('ruler-rem-base', 16);

	useEffect(() => {
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

	const handleToggle = useCallback(async () => {
		try {
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
		} catch (error: unknown) {
			logger.error('Failed to update ruler state', error);
		}
	}, [isActive]);

	const handleRemBaseChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const val = parseInt(e.target.value, 10) || 16;
		setRemBase(val);
	}, [setRemBase]);


	const handleCopyValue = useCallback(async (value: string) => {
		const ok = await copyToClipboard(value);
		showToast(ok ? t('rulerPanel.copied') : t('rulerPanel.copyFailed'));
	}, [showToast, t]);

	return (
		<div style={styles.wrapper}>
			<button type="button"
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
					<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
						{(['px', 'rem'] as const).map((u) => (
							<button
								key={u}
								type="button"
								style={{
									border: 'none',
									background: unit === u ? 'var(--halo-accent)' : 'transparent',
									color: unit === u ? '#fff' : 'var(--halo-text-muted)',
									padding: '4px 12px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
								}}
								onClick={() => setUnit(u)}
							>
								{u === 'px' ? t('rulerPanel.pixels') : t('rulerPanel.rem')}
							</button>
						))}
					</div>
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
		</div>
	);
};
