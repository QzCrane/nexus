// goal: Hash code generator panel UI

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateHash, generateFileHash } from './core';
import { ALGORITHMS, type HashAlgorithm } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	algoBtn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	resultBox: {
		padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '6px',
		fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all',
		border: '1px solid var(--halo-border)',
	},
	dropZone: {
		padding: '20px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer', marginLeft: 'auto',
	},
};

export const HashPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
	const [hash, setHash] = useState('');
	const [uppercase, setUppercase] = useState(false);
	const [loading, setLoading] = useState(false);

	const updateHash = useCallback(async (text: string, algo: HashAlgorithm) => {
		if (!text) {
			setHash('');
			return;
		}
		setLoading(true);
		const result = await generateHash(text, algo);
		setHash(result);
		setLoading(false);
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => updateHash(input, algorithm), 100);
		return () => clearTimeout(timer);
	}, [input, algorithm, updateHash]);

	const finalHash = uppercase ? hash.toUpperCase() : hash;

	const handleFileDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) {
			setLoading(true);
			const result = await generateFileHash(file, algorithm);
			setHash(result);
			setLoading(false);
			setInput(`[File: ${file.name} (${file.size} bytes)]`);
		}
	}, [algorithm]);

	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			setLoading(true);
			const result = await generateFileHash(file, algorithm);
			setHash(result);
			setLoading(false);
			setInput(`[File: ${file.name} (${file.size} bytes)]`);
		}
	}, [algorithm]);

	const copyToClipboard = () => {
		if (finalHash) navigator.clipboard.writeText(finalHash);
	};

	return (
		<div style={styles.wrapper}>
			{/* Algorithm Selection */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					{ALGORITHMS.map(algo => (
						<button
							key={algo}
							style={{ ...styles.algoBtn, ...(algorithm === algo ? styles.active : styles.inactive) }}
							onClick={() => setAlgorithm(algo)}
						>
							{algo}
						</button>
					))}
				</div>
			</Card>

			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<span style={styles.label}>{t('hash.input')}</span>
					<textarea
						style={styles.textarea}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t('hash.placeholder')}
					/>
					
					{/* Result */}
					{hash && (
						<>
							<div style={styles.row}>
								<span style={styles.label}>{t('hash.output')}</span>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
									<label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', cursor: 'pointer' }}>
										<input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
										{t('uuid.uppercase')}
									</label>
									<button style={styles.copyBtn} onClick={copyToClipboard}>
										📋 {t('common.copy')}
									</button>
								</div>
							</div>
							<div style={styles.resultBox}>
								{loading ? t('hash.calculating') : finalHash}
							</div>
						</>
					)}
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
					id="hash-file-input"
					onChange={handleFileSelect}
				/>
				<label htmlFor="hash-file-input" style={{ cursor: 'pointer' }}>
					📁 {t('hash.dropFile')}
				</label>
			</div>
		</div>
	);
};
