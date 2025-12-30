// goal: Base64 panel UI

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { encode, decode, fileToDataURL, getBase64Size } from './core';
import type { Base64Mode } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	textarea: {
		width: '100%', minHeight: '100px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	modeBtn: {
		flex: 1, padding: '10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' },
	actionBtn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	primaryBtn: { background: 'var(--halo-accent)', color: '#fff' },
	secondaryBtn: { background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	info: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	dropZone: {
		padding: '20px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
};

export const Base64Panel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<Base64Mode>('encode');
	const [input, setInput] = useState('');
	const [urlSafe, setUrlSafe] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const output = useMemo(() => {
		if (!input) return '';
		try {
			setError(null);
			return mode === 'encode' ? encode(input, urlSafe) : decode(input, urlSafe);
		} catch (err) {
			setError((err as Error).message);
			return '';
		}
	}, [input, mode, urlSafe]);

	const handleCopy = useCallback(async () => {
		if (output) {
			await navigator.clipboard.writeText(output);
		}
	}, [output]);

	const handleSwap = useCallback(() => {
		setInput(output);
		setMode((prev) => (prev === 'encode' ? 'decode' : 'encode'));
	}, [output]);

	const handleFileDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) {
			try {
				const dataUrl = await fileToDataURL(file);
				setInput(dataUrl);
				setMode('decode');
			} catch {
				setError('Failed to read file');
			}
		}
	}, []);

	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			try {
				const dataUrl = await fileToDataURL(file);
				setInput(dataUrl);
				setMode('decode');
			} catch {
				setError('Failed to read file');
			}
		}
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Mode Toggle */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<button
						style={{ ...styles.modeBtn, ...(mode === 'encode' ? styles.active : styles.inactive) }}
						onClick={() => setMode('encode')}
					>
						📤 {t('base64.encode') || 'Encode'}
					</button>
					<button
						style={{ ...styles.modeBtn, ...(mode === 'decode' ? styles.active : styles.inactive) }}
						onClick={() => setMode('decode')}
					>
						📥 {t('base64.decode') || 'Decode'}
					</button>
				</div>
			</Card>

			{/* Options */}
			<Card variant="default" padding="sm">
				<label style={styles.checkbox}>
					<input type="checkbox" checked={urlSafe} onChange={(e) => setUrlSafe(e.target.checked)} />
					<span>{t('base64.urlSafe') || 'URL-safe Base64'}</span>
				</label>
			</Card>

			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('base64.input') || 'Input'}</span>
						<span style={styles.info}>{input.length} chars</span>
					</div>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={mode === 'encode'
							? (t('base64.inputPlaceholder') || 'Text to encode...')
							: (t('base64.decodePlaceholder') || 'Base64 to decode...')
						}
					/>
				</div>
			</Card>

			{/* File Drop (for encode) */}
			{mode === 'encode' && (
				<div
					style={styles.dropZone}
					onDrop={handleFileDrop}
					onDragOver={(e) => e.preventDefault()}
				>
					<input
						type="file"
						style={{ display: 'none' }}
						id="file-input"
						onChange={handleFileSelect}
					/>
					<label htmlFor="file-input" style={{ cursor: 'pointer' }}>
						📁 {t('base64.dropFile') || 'Drop file here or click to select'}
					</label>
				</div>
			)}

			{/* Error */}
			{error && <div style={styles.error}>⚠️ {error}</div>}

			{/* Output */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('base64.output') || 'Output'}</span>
						<span style={styles.info}>
							{output.length} chars
							{mode === 'encode' && output && ` (~${getBase64Size(output)} bytes)`}
						</span>
					</div>
					<textarea
						style={{ ...styles.textarea, background: 'var(--halo-bg-secondary)' }}
						value={output}
						readOnly
						placeholder={t('base64.outputPlaceholder') || 'Result will appear here...'}
					/>
					<div style={styles.row}>
						<button style={{ ...styles.actionBtn, ...styles.primaryBtn }} onClick={handleCopy}>
							📋 {t('common.copy') || 'Copy'}
						</button>
						<button style={{ ...styles.actionBtn, ...styles.secondaryBtn }} onClick={handleSwap}>
							🔄 {t('base64.swap') || 'Swap'}
						</button>
						<button
							style={{ ...styles.actionBtn, ...styles.secondaryBtn }}
							onClick={() => { setInput(''); setError(null); }}
						>
							🗑️ {t('common.clear') || 'Clear'}
						</button>
					</div>
				</div>
			</Card>
		</div>
	);
};
