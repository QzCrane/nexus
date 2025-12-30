// goal: Measurement display logic
// eff: Extracted to separate file

import React from 'react';
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
					<span
						style={styles.measureValue}
						onClick={() => onCopy(widthStr)}
						title="Click to copy"
					>
						{widthStr}
					</span>
				</div>
				<div style={styles.measureItem}>
					<span style={styles.measureLabel}>{t('rulerPanel.height')}</span>
					<span
						style={styles.measureValue}
						onClick={() => onCopy(heightStr)}
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
					onClick={() => onCopy(diagStr)}
					title="Click to copy"
				>
					{diagStr}
				</span>
			</div>
		</div>
	);
};
