// goal: Hash code generator panel - shows ALL algorithms simultaneously
// eff: No algorithm selection needed, all results displayed at once

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { generateHash, generateFileHash } from './core';
import { ALGORITHMS, type HashAlgorithm } from './types';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '70px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	resultRow: {
		display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px', border: '1px solid var(--halo-border)',
	},
	algoLabel: {
		fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)', minWidth: '60px',
		fontFamily: 'monospace', textTransform: 'uppercase' as const,
	},
	hashValue: {
		flex: 1, fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all',
		color: 'var(--halo-text)', lineHeight: 1.4,
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', flexShrink: 0,
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	dropZone: {
		padding: '16px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
	optionsRow: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px',
	},
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '6px' },
};

type HashResults = Record<HashAlgorithm, string>;

export const HashPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [uppercase, setUppercase] = useState(false);
	const [loading, setLoading] = useState(false);
	const [hashes, setHashes] = useState<HashResults>({} as HashResults);
	const [copiedAlgo, setCopiedAlgo] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);

	// Calculate all hashes simultaneously
	const calculateAllHashes = useCallback(async (text: string) => {
		if (!text) {
			setHashes({} as HashResults);
			return;
		}
		setLoading(true);
		const results: Partial<HashResults> = {};
		await Promise.all(
			ALGORITHMS.map(async (algo) => {
				results[algo] = await generateHash(text, algo);
			})
		);
		setHashes(results as HashResults);
		setLoading(false);
	}, []);

	// Calculate all hashes for file
	const calculateFileHashes = useCallback(async (file: File) => {
		setLoading(true);
		setFileName(file.name);
		const results: Partial<HashResults> = {};
		await Promise.all(
			ALGORITHMS.map(async (algo) => {
				results[algo] = await generateFileHash(file, algo);
			})
		);
		setHashes(results as HashResults);
		setLoading(false);
	}, []);

	// Debounced text input
	useEffect(() => {
		if (fileName) return; // Skip if we're showing file hash
		const timer = setTimeout(() => calculateAllHashes(input), 150);
		return () => clearTimeout(timer);
	}, [input, calculateAllHashes, fileName]);

	const handleFileDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) calculateFileHashes(file);
	}, [calculateFileHashes]);

	const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) calculateFileHashes(file);
	}, [calculateFileHashes]);

	const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setFileName(null);
		setInput(e.target.value);
	}, []);

	const copyHash = useCallback((algo: HashAlgorithm, value: string) => {
		const finalValue = uppercase ? value.toUpperCase() : value;
		navigator.clipboard.writeText(finalValue);
		setCopiedAlgo(algo);
		setTimeout(() => setCopiedAlgo(null), 1500);
	}, [uppercase]);

	const hasResults = useMemo(() => Object.keys(hashes).length > 0, [hashes]);

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.optionsRow}>
						<span style={styles.label}>
							{fileName ? `📁 ${fileName}` : t('hash.input')}
						</span>
						{hasResults && (
							<label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
								<input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
								{t('uuid.uppercase')}
							</label>
						)}
					</div>
					<textarea
						style={styles.textarea}
						value={fileName ? `[${t('hash.fileSelected')}: ${fileName}]` : input}
						onChange={handleTextChange}
						placeholder={t('hash.placeholder')}
						disabled={!!fileName}
					/>
					{fileName && (
						<button
							style={{ ...styles.copyBtn, alignSelf: 'flex-start' }}
							onClick={() => { setFileName(null); setInput(''); setHashes({} as HashResults); }}
						>
							🔄 {t('common.clear')}
						</button>
					)}
				</div>
			</Card>

			{/* All Hash Results */}
			{loading ? (
				<Card variant="default" padding="sm">
					<div style={{ textAlign: 'center', color: 'var(--halo-text-muted)', padding: '20px' }}>
						⏳ {t('hash.calculating')}...
					</div>
				</Card>
			) : hasResults && (
				<div style={styles.resultsGrid}>
					{ALGORITHMS.map((algo) => {
						const value = hashes[algo] || '';
						const displayValue = uppercase ? value.toUpperCase() : value;
						const isCopied = copiedAlgo === algo;
						return (
							<div key={algo} style={styles.resultRow}>
								<span style={styles.algoLabel}>{algo}</span>
								<span style={styles.hashValue}>{displayValue}</span>
								<button
									style={{ ...styles.copyBtn, ...(isCopied ? styles.copyBtnSuccess : {}) }}
									onClick={() => copyHash(algo, value)}
								>
									{isCopied ? '✓' : '📋'}
								</button>
							</div>
						);
					})}
				</div>
			)}

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
