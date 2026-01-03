// goal: Timestamp converter - shows ALL formats and timezones simultaneously

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { autoParse, formatWithTZ, getRelativeTime, TIMEZONES } from './core';
import { useToolState } from '../../kernel';


const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '10px' },
	input: { width: '100%', padding: '10px 12px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '8px', color: 'var(--halo-text)', fontSize: '13px', fontFamily: 'monospace' },
	resultRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--halo-bg-secondary)', borderRadius: '6px', border: '1px solid var(--halo-border)' },
	label: { fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)', minWidth: '70px', textTransform: 'uppercase' },
	val: { flex: 1, fontSize: '11px', fontFamily: 'monospace', color: 'var(--halo-text)', overflow: 'hidden', textOverflow: 'ellipsis' },
	btn: { padding: '4px 8px', borderRadius: '4px', fontSize: '10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text-secondary)', cursor: 'pointer' },
	clock: { fontSize: '24px', fontWeight: 700, textAlign: 'center', color: 'var(--halo-accent)', cursor: 'pointer' },
};

export const TimestampPanel: React.FC = () => {
	const { t } = useTranslation();
	const [now, setNow] = useState(Date.now());
	const [input, setInput] = useToolState<string>('timestamp', '');

	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | null = null;
		
		const start = () => {
			if (!timer) timer = setInterval(() => setNow(Date.now()), 1000);
		};
		const stop = () => {
			if (timer) { clearInterval(timer); timer = null; }
		};
		
		const onVis = () => document.visibilityState === 'visible' ? start() : stop();
		document.addEventListener('visibilitychange', onVis);
		if (document.visibilityState === 'visible') start();
		
		return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
	}, []);

	const parsedDate = useMemo(() => autoParse(input) || new Date(now), [input, now]);

	const copyValue = useCallback((key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey(null), 1500);
	}, []);

	const results = useMemo(() => [
		{ k: 'unix_s', l: t('timestamp.unixS', { defaultValue: 'Unix (s)' }), v: Math.floor(parsedDate.getTime() / 1000).toString() },
		{ k: 'unix_ms', l: t('timestamp.unixMs', { defaultValue: 'Unix (ms)' }), v: parsedDate.getTime().toString() },
		{ k: 'iso', l: t('timestamp.iso8601', { defaultValue: 'ISO 8601' }), v: parsedDate.toISOString() },
		{ k: 'relative', l: t('timestamp.relative', { defaultValue: 'Relative' }), v: getRelativeTime(parsedDate, now) },
		...TIMEZONES.map(tz => ({ k: tz.value, l: tz.label, v: formatWithTZ(parsedDate, tz.value) }))
	], [parsedDate, now, t]);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
					<div style={styles.clock} onClick={() => copyValue('now', Math.floor(now/1000).toString())}>{Math.floor(now/1000)}</div>
					<div style={{ textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '10px' }}>{new Date(now).toLocaleString()}</div>
				</div>
			</Card>

			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<span style={{ fontSize: '11px', fontWeight: 600 }}>{t('timestamp.inputLabel', { defaultValue: 'INPUT' })}</span>
						<button style={styles.btn} onClick={() => setInput('')}>{t('timestamp.clear', { defaultValue: 'Clear' })}</button>
					</div>
					<input style={styles.input} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('timestamp.placeholder', { defaultValue: 'Unix timestamp or ISO string...' })} />
				</div>
			</Card>

			<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
				{results.map(r => (
					<div key={r.k} style={styles.resultRow}>
						<span style={styles.label}>{r.l}</span>
						<span style={styles.val}>{r.v}</span>
						<button style={{ ...styles.btn, ...(copiedKey === r.k ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }} onClick={() => copyValue(r.k, r.v)}>
							{copiedKey === r.k ? '✓' : t('timestamp.copy', { defaultValue: 'Copy' })}
						</button>
					</div>
				))}
			</div>
		</div>
	);
};
