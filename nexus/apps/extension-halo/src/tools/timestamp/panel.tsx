// goal: Timestamp converter panel UI

import React, { useState, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { formatTimestamp, parseDateToTs, getCurrentTimestamp } from './core';
import type { TimestampUnit } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	input: {
		flex: 1, padding: '10px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '8px',
		color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	resultBox: {
		padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '6px',
		fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
		border: '1px solid var(--halo-border)', width: '100%',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
	},
	primaryBtn: { background: 'var(--halo-accent)', color: '#fff', border: 'none' },
	clock: { fontSize: '24px', fontWeight: 700, textAlign: 'center' as const, color: 'var(--halo-accent)', padding: '10px 0' },
};

export const TimestampPanel: React.FC = () => {
	const { t } = useTranslation();
	const [now, setNow] = useState(Date.now());
	const [input, setInput] = useState('');
	const [mode, setMode] = useState<'ts2date' | 'date2ts'>('ts2date');
	const [unit, setUnit] = useState<TimestampUnit>('s'); // for input or output base

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	// Convert result
	const result = mode === 'ts2date' 
		? formatTimestamp(Number(input), unit) // treat input as `unit`
		: parseDateToTs(input, unit === 'ms' ? 'ms' : 's'); // output as `unit`

	const currentTs = unit === 's' ? Math.floor(now / 1000) : now;

	return (
		<div style={styles.wrapper}>
			{/* Current Time Display */}
			<Card variant="default" padding="sm">
				<div style={styles.clock}>{currentTs}</div>
				<div style={{ textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '11px' }}>
					{new Date(now).toLocaleString()}
				</div>
				<div style={{ ...styles.row, justifyContent: 'center', marginTop: '10px' }}>
					<button style={styles.btn} onClick={() => setUnit('s')} disabled={unit === 's'}>{t('timestamp.seconds')}</button>
					<button style={styles.btn} onClick={() => setUnit('ms')} disabled={unit === 'ms'}>{t('timestamp.milliseconds')}</button>
				</div>
			</Card>

			{/* Converter */}
			<Card variant="default" padding="sm">
				<div style={{ ...styles.row, marginBottom: '10px' }}>
					<button
						style={{ ...styles.btn, ...(mode === 'ts2date' ? styles.primaryBtn : {}) }}
						onClick={() => setMode('ts2date')}
					>
						{t('timestamp.tsToDate')}
					</button>
					<button
						style={{ ...styles.btn, ...(mode === 'date2ts' ? styles.primaryBtn : {}) }}
						onClick={() => setMode('date2ts')}
					>
						{t('timestamp.dateToTs')}
					</button>
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<span style={styles.label}>{mode === 'ts2date' ? t('timestamp.timestamp') : t('timestamp.dateString')}</span>
					<div style={styles.row}>
						<input
							style={styles.input}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={mode === 'ts2date' ? String(currentTs) : new Date().toISOString()}
						/>
						{mode === 'ts2date' && (
							<button style={styles.btn} onClick={() => setInput(String(currentTs))}>{t('timestamp.current')}</button>
						)}
						{mode === 'date2ts' && (
							<button style={styles.btn} onClick={() => setInput(new Date().toISOString())}>{t('timestamp.now')}</button>
						)}
					</div>

					<span style={styles.label}>{t('timestamp.result')}</span>
					<div style={styles.resultBox}>
						{input ? String(result) : '-'}
					</div>
				</div>
			</Card>
		</div>
	);
};
