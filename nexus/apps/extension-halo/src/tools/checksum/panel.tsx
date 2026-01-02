// goal: Checksum panel UI

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { HashAlgorithm } from './core';
import { calculateChecksum, verifyChecksum, formatFileSize } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const ChecksumPanel: React.FC = () => {
	const { t } = useTranslation();
	const [file, setFile] = useState<File | null>(null);
	const [algorithm, setAlgorithm] = useToolState<HashAlgorithm>('checksum-alg' as any, 'SHA-256');
	const [hash, setHash] = useState('');
	const [expected, setExpected] = useToolState<string>('checksum-verify' as any, '');

	const [loading, setLoading] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Handle file select
	const handleFile = useCallback(async (f: File) => {
		setFile(f);
		setLoading(true);
		const result = await calculateChecksum(f, algorithm);
		setHash(result.hash);
		setLoading(false);
	}, [algorithm]);

	// Handle drop
	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		const f = e.dataTransfer.files[0];
		if (f) handleFile(f);
	}, [handleFile]);

	// Handle algorithm change
	const handleAlgorithmChange = useCallback(async (alg: HashAlgorithm) => {
		setAlgorithm(alg);
		if (file) {
			setLoading(true);
			const result = await calculateChecksum(file, alg);
			setHash(result.hash);
			setLoading(false);
		}
	}, [file]);

	// Copy hash
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(hash);
	}, [hash]);

	const isMatch = expected ? verifyChecksum(hash, expected) : null;

	return (
		<div style={styles.wrapper}>
			{/* Dropzone */}
			<div style={styles.dropzone} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()}>
				{file ? (
					<div style={styles.file}>
						<div style={styles.fileName}>{file.name}</div>
						<div style={styles.fileSize}>{formatFileSize(file.size)}</div>
					</div>
				) : (
					<div style={{ color: 'var(--halo-text-muted)' }}>📁 {t('checksum.dropFile')}</div>
				)}
				<input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
			</div>

			{/* Algorithm */}
			<div style={styles.row}>
				<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{t('checksum.algorithm')}</span>
				<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
					{(['MD5', 'SHA-1', 'SHA-256', 'SHA-512'] as HashAlgorithm[]).map((a) => (
						<button
							key={a}
							type="button"
							style={{
								border: 'none',
								background: algorithm === a ? 'var(--halo-accent)' : 'transparent',
								color: algorithm === a ? '#fff' : 'var(--halo-text-muted)',
								padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
							}}
							onClick={() => handleAlgorithmChange(a)}
						>
							{a}
						</button>
					))}
				</div>
			</div>

			{/* Hash result */}
			{hash && (
				<div style={styles.hash} onClick={handleCopy}>{loading ? '⏳ Calculating...' : hash}</div>
			)}

			{/* Verify */}
			{hash && (
				<div style={styles.row}>
					<input style={styles.input} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={t('checksum.expectedHash')} />
				</div>
			)}

			{/* Match result */}
			{isMatch !== null && (
				<div style={{ ...styles.match, ...(isMatch ? styles.matchOk : styles.matchFail) }}>
					{isMatch ? '✅ Match!' : '❌ No match'}
				</div>
			)}
		</div>
	);
};
