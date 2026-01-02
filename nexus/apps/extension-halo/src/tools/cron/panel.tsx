// goal: Cron panel UI - cron expression parser and next run times

import React, { useState, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { parseCron, describeCron, getNextRuns, CRON_PRESETS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CronPanel: React.FC = () => {
	const { t } = useTranslation();
	const [cron, setCron] = useToolState<string>('cron', '0 9 * * 1-5');


	// Parse cron
	const parts = useMemo(() => parseCron(cron), [cron]);
	const description = useMemo(() => describeCron(cron), [cron]);
	const nextRuns = useMemo(() => getNextRuns(cron, 5), [cron]);

	const isValid = parts !== null;

	return (
		<div style={styles.wrapper}>
			{/* Cron Input */}
			<input
				style={{ ...styles.input, borderColor: isValid ? 'var(--halo-border)' : 'var(--halo-error, #ef4444)' }}
				value={cron}
				onChange={(e) => setCron(e.target.value)}
				placeholder="* * * * *"
			/>

			{/* Parts Breakdown */}
			{parts && (
				<div style={styles.parts}>
					<div style={styles.part}>
						<div style={styles.partLabel}>{t('cron.minute')}</div>
						<div style={styles.partValue}>{parts.minute}</div>
					</div>
					<div style={styles.part}>
						<div style={styles.partLabel}>{t('cron.hour')}</div>
						<div style={styles.partValue}>{parts.hour}</div>
					</div>
					<div style={styles.part}>
						<div style={styles.partLabel}>{t('cron.dayOfMonth')}</div>
						<div style={styles.partValue}>{parts.dayOfMonth}</div>
					</div>
					<div style={styles.part}>
						<div style={styles.partLabel}>{t('cron.month')}</div>
						<div style={styles.partValue}>{parts.month}</div>
					</div>
					<div style={styles.part}>
						<div style={styles.partLabel}>{t('cron.dayOfWeek')}</div>
						<div style={styles.partValue}>{parts.dayOfWeek}</div>
					</div>
				</div>
			)}

			{/* Human Description */}
			<div style={styles.description}>
				{isValid ? `📅 ${description}` : `⚠️ ${t('cron.invalid')}`}
			</div>

			{/* Presets */}
			<Card variant="default" padding="sm">
				<div style={styles.label}>{t('cron.presets')}</div>
				<div style={styles.presets}>
					{CRON_PRESETS.map((preset) => (
						<button key={preset.id} style={styles.preset} onClick={() => setCron(preset.cron)}>
							{preset.name}
						</button>
					))}
				</div>
			</Card>

			{/* Next Runs */}
			{nextRuns.length > 0 && (
				<Card variant="default" padding="sm">
					<div style={styles.label}>{t('cron.nextRuns')}</div>
					<div style={styles.nextRuns}>
						{nextRuns.map((run, i) => (
							<div key={i} style={styles.runItem}>
								{run.toLocaleString()}
							</div>
						))}
					</div>
				</Card>
			)}
		</div>
	);
};
