// goal: Checksum panel UI

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { HashAlgorithm } from './core';
import { calculateChecksum, verifyChecksum, formatFileSize } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

const checksumAlgorithmCodec: ToolStateCodec<HashAlgorithm> = {
	decode: (value) => value === 'MD5' || value === 'SHA-1' || value === 'SHA-256' || value === 'SHA-512'
		? { kind: 'valid', value } : { kind: 'invalid', reason: 'Checksum algorithm is invalid.' },
	encode: (value) => value,
};


export const ChecksumPanel: React.FC = () => {
	const { t } = useTranslation();
	const [file, setFile] = useState<File | null>(null);
	const [algorithm, setAlgorithm, , algorithmRecovery] = useToolState<HashAlgorithm>('checksum-alg', 'SHA-256', { codec: checksumAlgorithmCodec });
	const [hash, setHash] = useState('');
	const [expected, setExpected] = useToolState<string>('checksum-verify', '');

	const task = useOwnedAsyncTask();

	// Handle file select
	const handleFile = useCallback(async (f: File) => {
		setFile(f);
		const outcome = await task.run(() => calculateChecksum(f, algorithm));
		if (outcome.kind === 'succeeded') setHash(outcome.value.hash);
	}, [algorithm, task.run]);

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
			const outcome = await task.run(() => calculateChecksum(file, alg));
			if (outcome.kind === 'succeeded') setHash(outcome.value.hash);
		}
	}, [file, setAlgorithm, task.run]);

	// Copy hash
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(hash);
	}, [hash]);

	const isMatch = expected ? verifyChecksum(hash, expected) : null;

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={algorithmRecovery} emptyValue="SHA-256" exportName="halo-checksum-algorithm-damaged.json" />
			{/* Dropzone */}
			<label style={styles.dropzone} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
				{file ? (
					<div style={styles.file}>
						<div style={styles.fileName}>{file.name}</div>
						<div style={styles.fileSize}>{formatFileSize(file.size)}</div>
					</div>
				) : (
					<div style={{ color: 'var(--halo-text-muted)' }}>📁 {t('checksum.dropFile')}</div>
				)}
				<input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
			</label>

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
								padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
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
				<button type="button" style={{ ...styles.hash, textAlign: 'left', cursor: 'pointer' }} onClick={handleCopy}>
					{task.phase === 'running' ? '⏳ Calculating...' : hash}
				</button>
			)}
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}

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
