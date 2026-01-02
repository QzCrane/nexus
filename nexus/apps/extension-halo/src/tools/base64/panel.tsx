// goal: Base64 panel - shows BOTH encode AND decode with image preview

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { encode, decode, fileToDataURL, getBase64Size, decodeToBinary, downloadContent } from './core';

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
	resultHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
	resultLabel: { fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)', fontFamily: 'monospace', textTransform: 'uppercase' },
	resultValue: { fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--halo-text)', lineHeight: 1.4, maxHeight: '100px', overflow: 'auto' },
	btn: { padding: '4px 8px', borderRadius: '4px', fontSize: '10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s' },
	preview: { width: '100%', marginTop: '8px', borderRadius: '8px', border: '1px solid var(--halo-border)', background: '#fff', padding: '8px', display: 'flex', justifyContent: 'center' },
	img: { maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' },
};

export const Base64Panel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [urlSafe, setUrlSafe] = useState(false);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const isDataUrl = input.trim().startsWith('data:image/');

	const results = useMemo(() => {
		if (!input.trim()) return { encoded: null, decoded: null };
		let encoded = '';
		try { encoded = encode(input, urlSafe); } catch { encoded = ''; }
		let decoded = '';
		try { decoded = decode(input, urlSafe); } catch { decoded = ''; }
		return { encoded, decoded };
	}, [input, urlSafe]);

	const handleCopy = useCallback((key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey(null), 1500);
	}, []);

	const handleDownload = useCallback(() => {
		try {
			const binary = decodeToBinary(input, urlSafe);
			downloadContent(binary, 'decoded-file', 'application/octet-stream');
		} catch { alert('Download failed - invalid Base64'); }
	}, [input, urlSafe]);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Paste text or Base64 here..."
					/>
					<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
						<label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
							<input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} />
							URL-safe
						</label>
						<button style={styles.btn} onClick={() => setInput('')}>Clear</button>
						<div style={{ flex: 1 }} />
						<span style={{ fontSize: '10px', color: 'var(--halo-text-muted)' }}>{input.length} chars</span>
					</div>
				</div>
			</Card>

			{input.trim() && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
					{/* Image Preview */}
					{isDataUrl && (
						<div style={styles.preview}>
							<img src={input.trim()} style={styles.img} alt="Base64 Preview" />
						</div>
					)}

					{/* Encoded */}
					{results.encoded && (
						<div style={styles.resultRow}>
							<div style={styles.resultHeader}>
								<span style={styles.resultLabel}>Encoded</span>
								<button style={{ ...styles.btn, ...(copiedKey === 'enc' ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }} onClick={() => handleCopy('enc', results.encoded)}>
									{copiedKey === 'enc' ? '✓' : 'Copy'}
								</button>
							</div>
							<div style={styles.resultValue}>{results.encoded}</div>
						</div>
					)}

					{/* Decoded */}
					{results.decoded && (
						<div style={styles.resultRow}>
							<div style={styles.resultHeader}>
								<span style={{ ...styles.resultLabel, color: '#22c55e' }}>Decoded</span>
								<div style={{ display: 'flex', gap: '4px' }}>
									<button style={styles.btn} onClick={handleDownload}>Save as File</button>
									<button style={{ ...styles.btn, ...(copiedKey === 'dec' ? { background: 'var(--halo-accent)', color: '#fff' } : {}) }} onClick={() => handleCopy('dec', results.decoded)}>
										{copiedKey === 'dec' ? '✓' : 'Copy'}
									</button>
								</div>
							</div>
							<div style={styles.resultValue}>{results.decoded}</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
