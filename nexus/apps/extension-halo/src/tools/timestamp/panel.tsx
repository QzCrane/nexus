// goal: Timestamp converter - shows ALL formats simultaneously
// eff: Auto-detect input, display all conversions at once

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { formatTimestamp, parseDateToTs, getCurrentTimestamp } from './core';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	input: {
		width: '100%', padding: '10px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '8px',
		color: 'var(--halo-text)', fontSize: '13px', fontFamily: 'monospace',
	},
	resultRow: {
		display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px', border: '1px solid var(--halo-border)',
	},
	formatLabel: {
		fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)', minWidth: '80px',
		fontFamily: 'monospace', textTransform: 'uppercase' as const,
	},
	formatValue: {
		flex: 1, fontSize: '11px', fontFamily: 'monospace',
		color: 'var(--halo-text)', overflow: 'hidden', textOverflow: 'ellipsis',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', flexShrink: 0,
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	clock: {
		fontSize: '28px', fontWeight: 700, textAlign: 'center' as const,
		color: 'var(--halo-accent)', padding: '8px 0', fontFamily: 'monospace',
	},
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '6px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
	},
};

interface TimeFormat {
	key: string;
	label: string;
	getValue: (date: Date) => string;
}

export const TimestampPanel: React.FC = () => {
	const { t } = useTranslation();
	const [now, setNow] = useState(Date.now());
	const [input, setInput] = useState('');
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	// Auto-detect input and parse to Date
	const parsedDate = useMemo((): Date | null => {
		if (!input.trim()) return new Date(now);
		const trimmed = input.trim();
		
		// Try as Unix timestamp (seconds)
		if (/^\d{10}$/.test(trimmed)) {
			return new Date(parseInt(trimmed, 10) * 1000);
		}
		// Try as Unix timestamp (milliseconds)
		if (/^\d{13}$/.test(trimmed)) {
			return new Date(parseInt(trimmed, 10));
		}
		// Try as ISO string or other date format
		const parsed = new Date(trimmed);
		return isNaN(parsed.getTime()) ? null : parsed;
	}, [input, now]);

	// All time formats to display
	const formats: TimeFormat[] = useMemo(() => [
		{ key: 'unix_s', label: t('timestamp.unixSec') || 'Unix (s)', getValue: (d) => Math.floor(d.getTime() / 1000).toString() },
		{ key: 'unix_ms', label: t('timestamp.unixMs') || 'Unix (ms)', getValue: (d) => d.getTime().toString() },
		{ key: 'iso', label: 'ISO 8601', getValue: (d) => d.toISOString() },
		{ key: 'local', label: t('timestamp.local') || 'Local', getValue: (d) => d.toLocaleString() },
		{ key: 'utc', label: 'UTC', getValue: (d) => d.toUTCString() },
		{ key: 'date', label: t('timestamp.date') || 'Date', getValue: (d) => d.toLocaleDateString() },
		{ key: 'time', label: t('timestamp.time') || 'Time', getValue: (d) => d.toLocaleTimeString() },
		{ key: 'relative', label: t('timestamp.relative') || 'Relative', getValue: (d) => getRelativeTime(d, now) },
	], [t, now]);

	const copyValue = useCallback((key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey(null), 1500);
	}, []);

	const handleUseNow = useCallback(() => {
		setInput(Math.floor(Date.now() / 1000).toString());
	}, []);

	const handleClear = useCallback(() => {
		setInput('');
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Live Clock */}
			<Card variant="default" padding="sm">
				<div style={styles.clock} onClick={() => copyValue('now', Math.floor(now / 1000).toString())}>
					{Math.floor(now / 1000)}
				</div>
				<div style={{ textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '11px' }}>
					{new Date(now).toLocaleString()}
				</div>
			</Card>

			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
						<span style={styles.label}>{t('timestamp.input') || 'Input'}</span>
						<div style={{ display: 'flex', gap: '6px' }}>
							<button style={styles.btn} onClick={handleUseNow}>{t('timestamp.now') || 'Now'}</button>
							<button style={styles.btn} onClick={handleClear}>{t('common.clear') || 'Clear'}</button>
						</div>
					</div>
					<input
						style={styles.input}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('timestamp.placeholder') || 'Enter timestamp or date string...'}
					/>
					{input && !parsedDate && (
						<div style={{ color: '#ef4444', fontSize: '11px' }}>
							⚠️ {t('timestamp.invalid') || 'Invalid date/timestamp'}
						</div>
					)}
				</div>
			</Card>

			{/* All Format Results */}
			{parsedDate && (
				<div style={styles.resultsGrid}>
					{formats.map(({ key, label, getValue }) => {
						const value = getValue(parsedDate);
						const isCopied = copiedKey === key;
						return (
							<div key={key} style={styles.resultRow}>
								<span style={styles.formatLabel}>{label}</span>
								<span style={styles.formatValue}>{value}</span>
								<button
									style={{ ...styles.copyBtn, ...(isCopied ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue(key, value)}
								>
									{isCopied ? '✓' : '📋'}
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

// Helper: relative time
function getRelativeTime(date: Date, now: number): string {
	const diff = now - date.getTime();
	const absDiff = Math.abs(diff);
	const isPast = diff > 0;
	
	const seconds = Math.floor(absDiff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	
	let unit: string, value: number;
	if (days > 0) { unit = 'day'; value = days; }
	else if (hours > 0) { unit = 'hour'; value = hours; }
	else if (minutes > 0) { unit = 'minute'; value = minutes; }
	else { unit = 'second'; value = seconds; }
	
	const plural = value !== 1 ? 's' : '';
	return isPast ? `${value} ${unit}${plural} ago` : `in ${value} ${unit}${plural}`;
}
