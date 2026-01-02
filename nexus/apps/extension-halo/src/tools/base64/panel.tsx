// goal: Base64 panel - shows BOTH encode AND decode simultaneously
// eff: Auto-detect input type, display both results at once

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { encode, decode, fileToDataURL, getBase64Size } from './core';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	resultRow: {
		display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	resultHeader: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between',
	},
	resultLabel: {
		fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)',
		fontFamily: 'monospace', textTransform: 'uppercase' as const,
	},
	resultValue: {
		fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all',
		color: 'var(--halo-text)', lineHeight: 1.4, maxHeight: '80px', overflow: 'auto',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	info: { fontSize: '10px', color: 'var(--halo-text-muted)', marginLeft: 'auto' },
	optionsRow: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' },
	dropZone: {
		padding: '16px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
	},
};

export const Base64Panel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [urlSafe, setUrlSafe] = useState(false);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Calculate both encode and decode results
	const results = useMemo(() => {
		if (!input.trim()) return { encoded: null, decoded: null, isBase64: false };
		
		let encoded: string | null = null;
		let decoded: string | null = null;
		let isBase64 = false;
		
		// Always try to encode
		try {
			encoded = encode(input, urlSafe);
		} catch {
			encoded = null;
		}
		
		// Always try to decode (check if input looks like base64)
		try {
			// Check if input might be base64
			const base64Pattern = urlSafe 
				? /^[A-Za-z0-9_-]+={0,2}$/
				: /^[A-Za-z0-9+/]+={0,2}$/;
			
			if (base64Pattern.test(input.replace(/\s/g, ''))) {
				decoded = decode(input, urlSafe);
				isBase64 = true;
			}
		} catch {
			decoded = null;
		}
		
		return { encoded, decoded, isBase64 };
	}, [input, urlSafe]);

	const copyValue = useCallback((key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey(null), 1500);
	}, []);

	const handleFileDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) {
			try {
				const dataUrl = await fileToDataURL(file);
				setInput(dataUrl);
			} catch { /* ignore */ }
		}
	}, []);

	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			try {
				const dataUrl = await fileToDataURL(file);
				setInput(dataUrl);
			} catch { /* ignore */ }
		}
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.optionsRow}>
						<span style={styles.label}>{t('base64.input') || 'Input'}</span>
						<label style={styles.checkbox}>
							<input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} />
							{t('base64.urlSafe') || 'URL-safe'}
						</label>
						<span style={styles.info}>{input.length} chars</span>
					</div>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('base64.placeholder') || 'Enter text or Base64 string...'}
					/>
					<div style={{ display: 'flex', gap: '8px' }}>
						<button style={styles.btn} onClick={() => setInput('')}>
							🗑️ {t('common.clear') || 'Clear'}
						</button>
					</div>
				</div>
			</Card>

			{/* File Drop */}
			<div
				style={styles.dropZone}
				onDrop={handleFileDrop}
				onDragOver={(e) => e.preventDefault()}
			>
				<input
					type="file"
					style={{ display: 'none' }}
					id="base64-file-input"
					onChange={handleFileSelect}
				/>
				<label htmlFor="base64-file-input" style={{ cursor: 'pointer' }}>
					📁 {t('base64.dropFile') || 'Drop file here or click to select'}
				</label>
			</div>

			{/* Results - Show BOTH encode and decode */}
			{input.trim() && (
				<div style={styles.resultsGrid}>
					{/* Encoded Result */}
					{results.encoded && (
						<div style={styles.resultRow}>
							<div style={styles.resultHeader}>
								<span style={styles.resultLabel}>
									📤 {t('base64.encoded') || 'Encoded'} ({results.encoded.length} chars, ~{getBase64Size(results.encoded)} bytes)
								</span>
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
					{results.decoded && (
						<div style={styles.resultRow}>
							<div style={styles.resultHeader}>
								<span style={{ ...styles.resultLabel, color: '#22c55e' }}>
									📥 {t('base64.decoded') || 'Decoded'} ({results.decoded.length} chars)
								</span>
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

					{/* Detection hint */}
					{results.isBase64 && (
						<div style={{ fontSize: '10px', color: 'var(--halo-text-muted)', textAlign: 'center' }}>
							✨ {t('base64.detected') || 'Input detected as Base64, showing both encode and decode'}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
