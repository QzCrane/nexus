// goal: PDF Panel UI
// eff: Drag-drop + operation selection + progress feedback

import React, { useState, useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PDFDocument as PDFDoc, PDFOperation, PDFToolState } from './types';
import { mergePDFs, getPageCount, validatePDF } from './core';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropZone: {
		padding: '32px 20px', border: '2px dashed var(--halo-border)', borderRadius: '12px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px', cursor: 'pointer',
		transition: 'all 0.2s', background: 'var(--halo-bg-tertiary)',
	},
	dropZoneActive: {
		borderColor: 'var(--halo-accent)', background: 'rgba(124, 58, 237, 0.1)',
	},
	fileList: { display: 'flex', flexDirection: 'column', gap: '8px' },
	fileItem: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between',
		padding: '10px 12px', background: 'var(--halo-bg-tertiary)', borderRadius: '8px',
		border: '1px solid var(--halo-border)',
	},
	fileName: { fontSize: '12px', fontWeight: 500, color: 'var(--halo-text)' },
	fileMeta: { fontSize: '10px', color: 'var(--halo-text-muted)' },
	opGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' },
	opBtn: {
		display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
		padding: '12px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)',
	},
	opActive: { background: 'var(--halo-accent)', borderColor: 'var(--halo-accent)', color: '#fff' },
	actionBtn: {
		width: '100%', padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
		cursor: 'pointer', border: 'none', background: 'var(--halo-accent)', color: '#fff',
		transition: 'all 0.15s',
	},
	actionBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
	removeBtn: {
		padding: '4px 8px', background: 'transparent', border: 'none', fontSize: '14px',
		cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.15s',
	},
	error: {
		padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px',
		fontSize: '12px', color: '#ef4444',
	},
	success: {
		padding: '10px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px',
		fontSize: '12px', color: '#22c55e',
	},
	label: {
		fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)',
		textTransform: 'uppercase',
	},
};

const OPERATIONS: { id: PDFOperation; icon: string; label: string; minFiles: number }[] = [
	{ id: 'merge', icon: '📎', label: 'Merge', minFiles: 2 },
	{ id: 'split', icon: '✂️', label: 'Split', minFiles: 1 },
	{ id: 'extract', icon: '📄', label: 'Extract', minFiles: 1 },
	{ id: 'rotate', icon: '🔄', label: 'Rotate', minFiles: 1 },
	{ id: 'watermark', icon: '💧', label: 'Watermark', minFiles: 1 },
	{ id: 'images-to-pdf', icon: '🖼️', label: 'Imgs→PDF', minFiles: 1 },
];

export const PDFPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, setState] = useState<PDFToolState>({
		files: [],
		selectedOperation: null,
		processing: false,
		error: null,
	});
	const [dragActive, setDragActive] = useState(false);
	const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		setDragActive(false);
		const items = Array.from(e.dataTransfer.files);
		await processFiles(items);
	}, []);

	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const items = Array.from(e.target.files || []);
		await processFiles(items);
		e.target.value = ''; // Reset for re-select
	}, []);

	const processFiles = async (files: File[]) => {
		const validFiles: PDFDoc[] = [];
		for (const file of files) {
			const buffer = await file.arrayBuffer();
			const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');
			const isImage = file.type.startsWith('image/');
			
			if (isPDF) {
				const valid = await validatePDF(buffer);
				if (valid) {
					const pages = await getPageCount(buffer);
					validFiles.push({
						id: crypto.randomUUID(),
						name: file.name,
						pageCount: pages,
						size: file.size,
						createdAt: Date.now(),
						data: buffer,
					});
				}
			} else if (isImage) {
				validFiles.push({
					id: crypto.randomUUID(),
					name: file.name,
					pageCount: 1,
					size: file.size,
					createdAt: Date.now(),
					data: buffer,
				});
			}
		}
		if (validFiles.length > 0) {
			setState((prev) => ({ ...prev, files: [...prev.files, ...validFiles], error: null }));
		}
	};

	const handleRemoveFile = useCallback((id: string) => {
		setState((prev) => ({
			...prev,
			files: prev.files.filter((f) => f.id !== id),
		}));
	}, []);

	const handleSelectOp = useCallback((op: PDFOperation) => {
		setState((prev) => ({ ...prev, selectedOperation: op, error: null }));
		setResult(null);
	}, []);

	const canExecute = useMemo(() => {
		if (!state.selectedOperation || state.processing) return false;
		const op = OPERATIONS.find((o) => o.id === state.selectedOperation);
		return op ? state.files.length >= op.minFiles : false;
	}, [state.selectedOperation, state.files.length, state.processing]);

	const handleExecute = useCallback(async () => {
		if (!canExecute) return;
		setState((prev) => ({ ...prev, processing: true, error: null }));
		setResult(null);

		try {
			const { selectedOperation, files } = state;
			let output: ArrayBuffer | null = null;
			let outputName = 'output.pdf';

			if (selectedOperation === 'merge') {
				const res = await mergePDFs({ documents: files.map((f) => f.data) });
				if (res.success) {
					output = res.data;
					outputName = 'merged.pdf';
				} else {
					throw new Error(res.error);
				}
			}

			// TODO: Implement other operations

			if (output) {
				const blob = new Blob([output], { type: 'application/pdf' });
				setResult({ blob, name: outputName });
			}
		} catch (err) {
			setState((prev) => ({ ...prev, error: (err as Error).message }));
		} finally {
			setState((prev) => ({ ...prev, processing: false }));
		}
	}, [state, canExecute]);

	const handleDownload = useCallback(() => {
		if (!result) return;
		const url = URL.createObjectURL(result.blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = result.name;
		a.click();
		URL.revokeObjectURL(url);
	}, [result]);

	const formatSize = (bytes: number) => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1048576).toFixed(1)} MB`;
	};

	return (
		<div style={styles.wrapper}>
			{/* Drop Zone */}
			<div
				style={{ ...styles.dropZone, ...(dragActive ? styles.dropZoneActive : {}) }}
				onDrop={handleDrop}
				onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
				onDragLeave={() => setDragActive(false)}
			>
				<input
					type="file"
					accept=".pdf,image/*"
					multiple
					style={{ display: 'none' }}
					id="pdf-file-input"
					onChange={handleFileSelect}
				/>
				<label htmlFor="pdf-file-input" style={{ cursor: 'pointer' }}>
					<div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
					<div>{t('pdfPanel.dropHint') || 'Drop PDFs or images here'}</div>
					<div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
						{t('pdfPanel.clickToSelect') || 'or click to select files'}
					</div>
				</label>
			</div>

			{/* File List */}
			{state.files.length > 0 && (
				<Card variant="default" padding="sm">
					<div style={styles.fileList}>
						<div style={styles.label}>{t('pdfPanel.files') || 'Files'} ({state.files.length})</div>
						{state.files.map((file) => (
							<div key={file.id} style={styles.fileItem}>
								<div>
									<div style={styles.fileName}>📄 {file.name}</div>
									<div style={styles.fileMeta}>
										{file.pageCount} {t('pdfPanel.pages') || 'pages'} • {formatSize(file.size)}
									</div>
								</div>
								<button
									style={styles.removeBtn}
									onClick={() => handleRemoveFile(file.id)}
									title={t('common.remove') || 'Remove'}
								>
									✕
								</button>
							</div>
						))}
					</div>
				</Card>
			)}

			{/* Operations */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
					<div style={styles.label}>{t('pdfPanel.operation') || 'Operation'}</div>
					<div style={styles.opGrid}>
						{OPERATIONS.map((op) => (
							<button
								key={op.id}
								style={{
									...styles.opBtn,
									...(state.selectedOperation === op.id ? styles.opActive : {}),
								}}
								onClick={() => handleSelectOp(op.id)}
							>
								<span style={{ fontSize: '20px' }}>{op.icon}</span>
								<span>{op.label}</span>
							</button>
						))}
					</div>
				</div>
			</Card>

			{/* Error */}
			{state.error && <div style={styles.error}>⚠️ {state.error}</div>}

			{/* Result */}
			{result && (
				<div style={styles.success}>
					✅ {t('pdfPanel.ready') || 'Ready!'} - {result.name} ({formatSize(result.blob.size)})
				</div>
			)}

			{/* Actions */}
			<div style={{ display: 'flex', gap: '8px' }}>
				{result ? (
					<button style={styles.actionBtn} onClick={handleDownload}>
						⬇️ {t('common.download') || 'Download'}
					</button>
				) : (
					<button
						style={{ ...styles.actionBtn, ...(canExecute ? {} : styles.actionBtnDisabled) }}
						onClick={handleExecute}
						disabled={!canExecute}
					>
						{state.processing ? '⏳ Processing...' : `▶️ ${t('pdfPanel.process') || 'Process'}`}
					</button>
				)}
			</div>

			{/* Local-first badge */}
			<div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--halo-text-muted)' }}>
				🔒 {t('pdfPanel.localOnly') || 'All processing runs locally. Your files never leave your device.'}
			</div>
		</div>
	);
};
