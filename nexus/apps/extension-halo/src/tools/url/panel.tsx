// goal: URL tool panel - shows ALL results simultaneously
// eff: No mode selection, display encode/decode/parse all at once

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { encode, decode, parseURL } from './core';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '70px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	resultSection: {
		padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '8px',
		border: '1px solid var(--halo-border)',
	},
	resultHeader: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px',
	},
	resultLabel: {
		fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)',
		fontFamily: 'monospace', textTransform: 'uppercase' as const,
	},
	resultValue: {
		fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all',
		color: 'var(--halo-text)', lineHeight: 1.4, maxHeight: '60px', overflow: 'auto',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	kvRow: { display: 'flex', borderBottom: '1px solid var(--halo-border)', padding: '6px 0', fontSize: '11px' },
	key: { width: '70px', fontWeight: 600, color: 'var(--halo-text-secondary)', flexShrink: 0 },
	val: { flex: 1, color: 'var(--halo-text)', fontFamily: 'monospace', wordBreak: 'break-all' as const },
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
	},
};

interface URLResults {
	encoded: string | null;
	decoded: string | null;
	parsed: Record<string, string> | null;
	isURL: boolean;
}

export const URLPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Calculate all results simultaneously
	const results = useMemo((): URLResults => {
		if (!input.trim()) return { encoded: null, decoded: null, parsed: null, isURL: false };
		
		let encoded: string | null = null;
		let decoded: string | null = null;
		let parsed: Record<string, string> | null = null;
		let isURL = false;
		
		// Always encode
		try {
			encoded = encode(input);
		} catch { encoded = null; }
		
		// Always try to decode
		try {
			decoded = decode(input);
		} catch { decoded = null; }
		
		// Try to parse as URL
		try {
			if (input.includes('://') || input.startsWith('/')) {
				parsed = parseURL(input);
				isURL = true;
			}
		} catch { parsed = null; }
		
		return { encoded, decoded, parsed, isURL };
	}, [input]);

	const copyValue = useCallback((key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey(null), 1500);
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
						<span style={styles.label}>{t('url.input') || 'Input'}</span>
						<button style={styles.btn} onClick={() => setInput('')}>
							🗑️ {t('common.clear') || 'Clear'}
						</button>
					</div>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('url.placeholder') || 'Enter URL or text to encode/decode...'}
					/>
				</div>
			</Card>

			{/* All Results */}
			{input.trim() && (
				<div style={styles.resultsGrid}>
					{/* Encoded Result */}
					{results.encoded && (
						<div style={styles.resultSection}>
							<div style={styles.resultHeader}>
								<span style={styles.resultLabel}>📤 {t('url.encoded') || 'URL Encoded'}</span>
								<button
									style={{ ...styles.copyBtn, ...(copiedKey === 'encoded' ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('encoded', results.encoded!)}
								>
									{copiedKey === 'encoded' ? '✓' : '📋'}
								</button>
							</div>
							<div style={styles.resultValue}>{results.encoded}</div>
						</div>
					)}

					{/* Decoded Result */}
					{results.decoded && results.decoded !== input && (
						<div style={styles.resultSection}>
							<div style={styles.resultHeader}>
								<span style={{ ...styles.resultLabel, color: '#22c55e' }}>📥 {t('url.decoded') || 'URL Decoded'}</span>
								<button
									style={{ ...styles.copyBtn, ...(copiedKey === 'decoded' ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('decoded', results.decoded!)}
								>
									{copiedKey === 'decoded' ? '✓' : '📋'}
								</button>
							</div>
							<div style={styles.resultValue}>{results.decoded}</div>
						</div>
					)}

					{/* Parsed URL Components */}
					{results.parsed && (
						<div style={styles.resultSection}>
							<div style={styles.resultHeader}>
								<span style={{ ...styles.resultLabel, color: '#f59e0b' }}>🔗 {t('url.parsed') || 'URL Components'}</span>
								<button
									style={{ ...styles.copyBtn, ...(copiedKey === 'parsed' ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('parsed', JSON.stringify(results.parsed, null, 2))}
								>
									{copiedKey === 'parsed' ? '✓' : '📋'}
								</button>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column' }}>
								{Object.entries(results.parsed).filter(([, val]) => val).map(([key, val]) => (
									<div key={key} style={styles.kvRow}>
										<div style={styles.key}>{key}</div>
										<div style={styles.val}>{val}</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
