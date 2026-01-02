// goal: URL tool panel UI

import React, { useState, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { encode, decode, parseURL } from './core';
import type { URLMode } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	textarea: {
		width: '100%', minHeight: '100px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	modeBtn: {
		flex: 1, padding: '8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	kvRow: { display: 'flex', borderBottom: '1px solid var(--halo-border)', padding: '8px 0', fontSize: '12px' },
	key: { width: '80px', fontWeight: 600, color: 'var(--halo-text-secondary)' },
	val: { flex: 1, color: 'var(--halo-text)', fontFamily: 'monospace', wordBreak: 'break-all' as const },
};

export const URLPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<URLMode>('encode');
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);

	const output = useMemo(() => {
		if (!input) return null;
		setError(null);
		try {
			if (mode === 'encode') return encode(input);
			if (mode === 'decode') return decode(input);
			if (mode === 'parse') return parseURL(input);
			return null;
		} catch (err) {
			setError((err as Error).message);
			return null;
		}
	}, [input, mode]);

	return (
		<div style={styles.wrapper}>
			{/* Mode Selection */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<button
						style={{ ...styles.modeBtn, ...(mode === 'encode' ? styles.active : styles.inactive) }}
						onClick={() => setMode('encode')}
					>
						{t('url.encode')}
					</button>
					<button
						style={{ ...styles.modeBtn, ...(mode === 'decode' ? styles.active : styles.inactive) }}
						onClick={() => setMode('decode')}
					>
						{t('url.decode')}
					</button>
					<button
						style={{ ...styles.modeBtn, ...(mode === 'parse' ? styles.active : styles.inactive) }}
						onClick={() => setMode('parse')}
					>
						{t('url.parse')}
					</button>
				</div>
			</Card>

			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<span style={styles.label}>{t('url.input')}</span>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('url.inputPlaceholder')}
					/>
				</div>
			</Card>

			{/* Error */}
			{error && <div style={styles.error}>⚠️ {error}</div>}

			{/* Output */}
			{output && (
				<Card variant="default" padding="sm">
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						<div style={styles.row}>
							<span style={styles.label}>{t('url.output')}</span>
							<button
								style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '12px' }}
								onClick={() => {
									if (typeof output === 'string') navigator.clipboard.writeText(output);
									else navigator.clipboard.writeText(JSON.stringify(output, null, 2));
								}}
							>
								📋
							</button>
						</div>
						
						{typeof output === 'string' ? (
							<textarea
								style={{ ...styles.textarea, background: 'var(--halo-bg-secondary)' }}
								value={output}
								readOnly
							/>
						) : (
							<div style={{ display: 'flex', flexDirection: 'column' }}>
								{Object.entries(output).map(([key, val]) => (
									<div key={key} style={styles.kvRow}>
										<div style={styles.key}>{key}</div>
										<div style={styles.val}>{val as string}</div>
									</div>
								))}
							</div>
						)}
					</div>
				</Card>
			)}
		</div>
	);
};
