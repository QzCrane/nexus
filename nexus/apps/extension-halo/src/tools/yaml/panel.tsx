// goal: YAML panel - shows BOTH conversions simultaneously
// eff: No mode selection, auto-detect input type, display both results

import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { parseYaml, jsonToYaml, detectInputType } from './core';
import { styles } from './panel.styles';

const resultStyles: Record<string, React.CSSProperties> = {
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
		fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
		color: 'var(--halo-text)', lineHeight: 1.4, maxHeight: '120px', overflow: 'auto',
		background: 'var(--halo-bg-tertiary)', padding: '8px', borderRadius: '6px',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
	detected: { fontSize: '10px', color: 'var(--halo-text-muted)', textAlign: 'center', marginTop: '8px' },
};

export const YamlPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Auto-detect input type and calculate both conversions
	const results = useMemo(() => {
		if (!input.trim()) return { json: null, yaml: null, detected: null, error: null };
		
		const detected = detectInputType(input);
		let json: string | null = null;
		let yaml: string | null = null;
		let error: string | null = null;
		
		if (detected === 'yaml') {
			// Input is YAML, convert to JSON
			const result = parseYaml(input);
			if (result.success) {
				json = result.output;
				yaml = input; // Original is already YAML
			} else {
				error = result.error || 'Invalid YAML';
			}
		} else if (detected === 'json') {
			// Input is JSON, convert to YAML
			const result = jsonToYaml(input);
			if (result.success) {
				yaml = result.output;
				json = input; // Original is already JSON (format it)
				try { json = JSON.stringify(JSON.parse(input), null, 2); } catch { /* keep as is */ }
			} else {
				error = result.error || 'Invalid JSON';
			}
		} else {
			error = 'Could not detect format';
		}
		
		return { json, yaml, detected, error };
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
						<span style={styles.label}>{t('yaml.input') || 'Input (YAML or JSON)'}</span>
						<button style={resultStyles.copyBtn} onClick={() => setInput('')}>
							🗑️ {t('common.clear') || 'Clear'}
						</button>
					</div>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('yaml.placeholder') || 'Paste YAML or JSON here...'}
					/>
					{results.detected && (
						<div style={resultStyles.detected}>
							✨ {t('yaml.detected') || 'Detected'}: <strong>{results.detected.toUpperCase()}</strong>
						</div>
					)}
				</div>
			</Card>

			{/* Error */}
			{results.error && <div style={styles.error}>⚠️ {results.error}</div>}

			{/* Both Results */}
			{(results.json || results.yaml) && (
				<div style={resultStyles.resultsGrid}>
					{/* JSON Result */}
					{results.json && (
						<div style={resultStyles.resultSection}>
							<div style={resultStyles.resultHeader}>
								<span style={resultStyles.resultLabel}>📋 JSON</span>
								<button
									style={{ ...resultStyles.copyBtn, ...(copiedKey === 'json' ? resultStyles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('json', results.json!)}
								>
									{copiedKey === 'json' ? '✓' : '📋'}
								</button>
							</div>
							<pre style={resultStyles.resultValue}>{results.json}</pre>
						</div>
					)}

					{/* YAML Result */}
					{results.yaml && (
						<div style={resultStyles.resultSection}>
							<div style={resultStyles.resultHeader}>
								<span style={{ ...resultStyles.resultLabel, color: '#22c55e' }}>📄 YAML</span>
								<button
									style={{ ...resultStyles.copyBtn, ...(copiedKey === 'yaml' ? resultStyles.copyBtnSuccess : {}) }}
									onClick={() => copyValue('yaml', results.yaml!)}
								>
									{copiedKey === 'yaml' ? '✓' : '📋'}
								</button>
							</div>
							<pre style={resultStyles.resultValue}>{results.yaml}</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
