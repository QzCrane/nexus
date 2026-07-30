// goal: Measurement display logic
// eff: Extracted to separate file

import type React from 'react';
import type { RulerMeasurement } from './types';
import { formatValue } from './core';
import { useTranslation } from '../../i18n';
import { styles } from './panel.styles';

interface MeasurementCardProps {
	measurement: RulerMeasurement;
	unit: 'px' | 'rem';
	remBase: number;
	onCopy: (val: string) => void;
}

export const MeasurementCard: React.FC<MeasurementCardProps> = ({
	measurement,
	unit,
	remBase,
	onCopy,
}) => {
	const { t } = useTranslation();
	const widthStr = formatValue(measurement.width, unit, remBase);
	const heightStr = formatValue(measurement.height, unit, remBase);
	const diagStr = formatValue(measurement.diagonal, unit, remBase);

	return (
		<div style={styles.measurementCard}>
			<div style={styles.measureGrid}>
				<div style={styles.measureItem}>
					<span style={styles.measureLabel}>{t('rulerPanel.width')}</span>
					<button
						type="button"
						style={{ ...styles.measureValue, padding: 0, border: 'none', background: 'transparent', textAlign: 'left' }}
						onClick={() => onCopy(widthStr)}
						title={t('rulerPanel.clickToCopy')}
					>
						{widthStr}
					</button>
				</div>
				<div style={styles.measureItem}>
					<span style={styles.measureLabel}>{t('rulerPanel.height')}</span>
					<button
						type="button"
						style={{ ...styles.measureValue, padding: 0, border: 'none', background: 'transparent', textAlign: 'left' }}
						onClick={() => onCopy(heightStr)}
						title={t('rulerPanel.clickToCopy')}
					>
						{heightStr}
					</button>
				</div>
			</div>
			<div style={styles.diagonalRow}>
				<span style={{ ...styles.measureLabel, margin: 0 }}>{t('rulerPanel.diagonal')}</span>
				<button
					type="button"
					style={{ ...styles.measureValue, fontSize: '14px', padding: 0, border: 'none', background: 'transparent' }}
					onClick={() => onCopy(diagStr)}
					title={t('rulerPanel.clickToCopy')}
				>
					{diagStr}
				</button>
			</div>
		</div>
	);
};
