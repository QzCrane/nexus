// goal: Timestamp converter panel UI

import React, { useState, useEffect, useCallback } from 'react';
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
		border: '1px solid var(--halo-border)', width: '100%', cursor: 'pointer',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
	},
	primaryBtn: { background: 'var(--halo-accent)', color: '#fff', border: 'none' },
	clock: { fontSize: '24px', fontWeight: 700, textAlign: 'center' as const, color: 'var(--halo-accent)', padding: '10px 0', cursor: 'pointer' },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', background: 'var(--halo-accent)', borderRadius: '24px', fontSize: '12px', fontWeight: 500, color: '#fff', zIndex: 1000 },
	copyBtn: { padding: '4px 8px', borderRadius: '4px', fontSize: '10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)', cursor: 'pointer', marginLeft: 'auto' },
};

export const TimestampPanel: React.FC = () => {
	const { t } = useTranslation();
	const [now, setNow] = useState(Date.now());
	const [input, setInput] = useState('');
	const [mode, setMode] = useState<'ts2date' | 'date2ts'>('ts2date');
	const [unit, setUnit] = useState<TimestampUnit>('s'); // for input or output base
	const [toast, setToast] = useState<string | null>(null);

	const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1500); }, []);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	// Convert result
	const result = mode === 'ts2date' 
		? formatTimestamp(Number(input), unit) // treat input as `unit`
		: parseDateToTs(input, unit === 'ms' ? 'ms' : 's'); // output as `unit`

	const currentTs = unit === 's' ? Math.floor(now / 1000) : now;

	const handleCopyResult = useCallback(() => {
		if (input && result) {
			navigator.clipboard.writeText(String(result));
			showToast(t('common.copied') || 'Copied!');
		}
	}, [input, result, showToast, t]);

	const handleCopyCurrentTs = useCallback(() => {
		navigator.clipboard.writeText(String(currentTs));
		showToast(t('common.copied') || 'Copied!');
	}, [currentTs, showToast, t]);

	return (
		<div style={styles.wrapper}>
			{/* Current Time Display */}
			<Card variant="default" padding="sm">
				<div style={styles.clock} onClick={handleCopyCurrentTs} title={t('common.clickToCopy') || 'Click to copy'}>{currentTs}</div>
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

					<div style={styles.row}>
						<span style={styles.label}>{t('timestamp.result')}</span>
						<button style={styles.copyBtn} onClick={handleCopyResult} disabled={!input}>📋 {t('common.copy')}</button>
					</div>
					<div style={styles.resultBox} onClick={handleCopyResult} title={t('common.clickToCopy') || 'Click to copy'}>
						{input ? String(result) : '-'}
					</div>
				</div>
			</Card>
			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
