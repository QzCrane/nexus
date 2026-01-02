// goal: XML Formatter panel - shows BOTH formatted AND minified simultaneously
// eff: No button clicks needed, display all results at once

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { XmlResult } from './types';
import { formatXml, minifyXml } from './core';
import { useToolState } from '../../kernel';


const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', fontFamily: 'monospace',
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
		fontSize: '10px', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
		color: 'var(--halo-text)', lineHeight: 1.4, maxHeight: '100px', overflow: 'auto',
		background: 'var(--halo-bg-tertiary)', padding: '8px', borderRadius: '6px',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
	stats: {
		display: 'flex', gap: '16px', padding: '10px', background: 'var(--halo-bg-secondary)',
		borderRadius: '8px', justifyContent: 'center',
	},
	stat: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' },
	statValue: { fontSize: '16px', fontWeight: 700, color: 'var(--halo-accent)' },
	statLabel: { fontSize: '10px', color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	valid: { color: '#22c55e' },
	invalid: { color: '#ef4444' },
	optionsRow: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px' },
	select: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '11px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
};

export const XmlFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('xml-formatter', '');
	const [indent, setIndent] = useToolState<number>('xml-formatter-indent' as any, 2);

	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Calculate both formatted and minified results
	const results = useMemo(() => {
		if (!input.trim()) return { formatted: null, minified: null, stats: null, error: null };
		
		const formatResult = formatXml(input, indent);
		const minifyResult = minifyXml(input);
		
		if (!formatResult.valid) {
			return { formatted: null, minified: null, stats: null, error: formatResult.error };
		}
		
		return {
			formatted: formatResult.formatted,
			minified: minifyResult.formatted,
			stats: formatResult.stats,
			error: null,
		};
	}, [input, indent]);

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
					<div style={styles.optionsRow}>
						<span style={styles.label}>{t('xmlFormatter.input') || 'XML Input'}</span>
						<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
							{[2, 4].map((n) => (
								<button
									key={n}
									type="button"
									style={{
										border: 'none',
										background: indent === n ? 'var(--halo-accent)' : 'transparent',
										color: indent === n ? '#fff' : 'var(--halo-text-muted)',
										padding: '4px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
									}}
									onClick={() => setIndent(n)}
								>
									{n} sp
								</button>
							))}
						</div>
						<button style={styles.copyBtn} onClick={() => setInput('')}>
							🗑️ {t('common.clear') || 'Clear'}
						</button>
					</div>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('xmlFormatter.placeholder') || 'Paste XML here...'}
					/>
				</div>
			</Card>

			{/* Error */}
			{results.error && <div style={styles.error}>⚠️ {results.error}</div>}

			{/* Stats */}
			{results.stats && (
				<div style={styles.stats}>
					<div style={styles.stat}>
						<span style={{ ...styles.statValue, ...styles.valid }}>✓</span>
						<span style={styles.statLabel}>{t('xmlFormatter.valid') || 'Valid'}</span>
					</div>
					<div style={styles.stat}>
						<span style={styles.statValue}>{results.stats.elements}</span>
						<span style={styles.statLabel}>{t('xmlFormatter.elements') || 'Elements'}</span>
					</div>
					<div style={styles.stat}>
						<span style={styles.statValue}>{results.stats.attributes}</span>
						<span style={styles.statLabel}>{t('xmlFormatter.attributes') || 'Attributes'}</span>
					</div>
				</div>
			)}

			{/* Both Results */}
			{(results.formatted || results.minified) && (
				<div style={styles.resultsGrid}>
					{/* Formatted Result */}
					{results.formatted && (
						<div style={styles.resultSection}>
							<div style={styles.resultHeader}>
								<span style={styles.resultLabel}>
									✨ {t('xmlFormatter.formatted') || 'Formatted'} ({results.formatted.length} chars)
								</span>
								<button
									style={{ ...styles.copyBtn, ...(copiedKey === 'formatted' ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('formatted', results.formatted!)}
								>
									{copiedKey === 'formatted' ? '✓' : '📋'}
								</button>
							</div>
							<pre style={styles.resultValue}>{results.formatted}</pre>
						</div>
					)}

					{/* Minified Result */}
					{results.minified && (
						<div style={styles.resultSection}>
							<div style={styles.resultHeader}>
								<span style={{ ...styles.resultLabel, color: '#f59e0b' }}>
									📦 {t('xmlFormatter.minified') || 'Minified'} ({results.minified.length} chars)
								</span>
								<button
									style={{ ...styles.copyBtn, ...(copiedKey === 'minified' ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('minified', results.minified!)}
								>
									{copiedKey === 'minified' ? '✓' : '📋'}
								</button>
							</div>
							<pre style={{ ...styles.resultValue, whiteSpace: 'nowrap', overflow: 'auto' }}>
								{results.minified}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
