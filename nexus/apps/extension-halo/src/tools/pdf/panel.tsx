// goal: PDF Panel UI (main component)
// eff: Styles extracted to reduce file size

import type React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PDFDocument as PDFDoc, PDFOperation, PDFToolState } from './types';
import { mergePDFs, splitPDF, extractPages, rotatePages, addWatermark, imagesToPDF, getPageCount, validatePDF } from './core';
import { ConfigPanel, DEFAULT_CONFIG, type OperationConfig } from './config-panel';
import { parseRanges, parsePages, formatSize } from './utils';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


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
	const [selectedOperation, setSelectedOperation] = useToolState<PDFOperation | null>('pdf-op', null);
	const [state, setState] = useState<PDFToolState>({ files: [], selectedOperation: null, processing: false, error: null });
	const [config, setConfig] = useToolState<OperationConfig>('pdf-config', DEFAULT_CONFIG);

	// Sync selectedOperation to state for backward compatibility with component logic if needed,
	// but better to use it directly.
	useEffect(() => {
		setState(prev => ({ ...prev, selectedOperation }));
	}, [selectedOperation]);

	const [dragActive, setDragActive] = useState(false);
	const [result, setResult] = useState<{ blob: Blob; name: string }[]>([]);

	const processFiles = useCallback(async (files: File[]) => {
		try {
			const validFiles: PDFDoc[] = [];
			for (const file of files) {
				const buffer = await file.arrayBuffer();
				const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');
				const isImage = file.type.startsWith('image/');
				if (isPDF) {
					const valid = await validatePDF(buffer);
					if (valid) {
						const pages = await getPageCount(buffer);
						validFiles.push({ id: crypto.randomUUID(), name: file.name, pageCount: pages, size: file.size, createdAt: Date.now(), data: buffer });
					}
				} else if (isImage) {
					validFiles.push({ id: crypto.randomUUID(), name: file.name, pageCount: 1, size: file.size, createdAt: Date.now(), data: buffer });
				}
			}
			if (validFiles.length > 0) {
				setState((prev) => ({ ...prev, files: [...prev.files, ...validFiles], error: null }));
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to read the selected file';
			setState((prev) => ({ ...prev, error: message }));
		}
	}, []);

	const handleDrop = useCallback(async (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); await processFiles(Array.from(e.dataTransfer.files)); }, [processFiles]);
	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => { await processFiles(Array.from(e.target.files || [])); e.target.value = ''; }, [processFiles]);
	const handleRemoveFile = useCallback((id: string) => setState((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) })), []);
	const handleSelectOp = useCallback((op: PDFOperation) => { 
		setSelectedOperation(op);
		setResult([]);
		setState(prev => ({ ...prev, error: null }));
	}, [setSelectedOperation]);


	const canExecute = useMemo(() => {
		if (!state.selectedOperation || state.processing) return false;
		const op = OPERATIONS.find((o) => o.id === state.selectedOperation);
		return op ? state.files.length >= op.minFiles : false;
	}, [state.selectedOperation, state.files.length, state.processing]);

	const handleExecute = useCallback(async () => {
		if (!canExecute) return;
		setState((prev) => ({ ...prev, processing: true, error: null }));
		setResult([]);
		try {
			const { selectedOperation, files } = state;
			const firstFile = files[0];
			if (!selectedOperation || !firstFile) {
				throw new Error('Select an operation and at least one file');
			}
			let outputs: { blob: Blob; name: string }[] = [];

			if (selectedOperation === 'merge') {
				const res = await mergePDFs({ documents: files.map((f) => f.data) });
				if (res.success) { outputs = [{ blob: new Blob([res.data], { type: 'application/pdf' }), name: 'merged.pdf' }]; } else throw new Error(res.error);
			} else if (selectedOperation === 'split') {
				const ranges = parseRanges(config.splitRanges);
				if (ranges.length === 0) throw new Error('Invalid page ranges');
				const res = await splitPDF({ document: firstFile.data, ranges });
				if (!res.success) throw new Error(res.error);
				if (res.data.length === 0) throw new Error('The selected ranges produced no PDF output');
				// rule: every split range produces its own download; dropping all
				// but the first would silently discard the requested results.
				outputs = res.data.map((part, index) => ({
					blob: new Blob([part], { type: 'application/pdf' }),
					name: res.data.length === 1 ? 'split.pdf' : `split-${index + 1}.pdf`,
				}));
			} else if (selectedOperation === 'extract') {
				const pages = parsePages(config.extractPages);
				if (pages.length === 0) throw new Error('Invalid page numbers');
				const res = await extractPages({ document: firstFile.data, pages });
				if (res.success) { outputs = [{ blob: new Blob([res.data], { type: 'application/pdf' }), name: 'extracted.pdf' }]; } else throw new Error(res.error);
			} else if (selectedOperation === 'rotate') {
				const res = await rotatePages({ document: firstFile.data, pages: [], degrees: config.rotateDegrees });
				if (res.success) { outputs = [{ blob: new Blob([res.data], { type: 'application/pdf' }), name: 'rotated.pdf' }]; } else throw new Error(res.error);
			} else if (selectedOperation === 'watermark') {
				const res = await addWatermark({ document: firstFile.data, text: config.watermarkText, opacity: config.watermarkOpacity });
				if (res.success) { outputs = [{ blob: new Blob([res.data], { type: 'application/pdf' }), name: 'watermarked.pdf' }]; } else throw new Error(res.error);
			} else if (selectedOperation === 'images-to-pdf') {
				const res = await imagesToPDF({ images: files.map((f) => f.data), pageSize: config.pageSize });
				if (res.success) { outputs = [{ blob: new Blob([res.data], { type: 'application/pdf' }), name: 'images.pdf' }]; } else throw new Error(res.error);
			}
			if (outputs.length > 0) setResult(outputs);
		} catch (err) {
			setState((prev) => ({ ...prev, error: (err as Error).message }));
		} finally {
			setState((prev) => ({ ...prev, processing: false }));
		}
	}, [state, config, canExecute]);

	const handleDownload = useCallback(() => {
		// Sequential small delays keep multi-part downloads from being swallowed
		// by the browser's multiple-download guard.
		result.forEach((part, index) => {
			setTimeout(() => {
				const url = URL.createObjectURL(part.blob);
				const a = document.createElement('a'); a.href = url; a.download = part.name; a.click();
				URL.revokeObjectURL(url);
			}, index * 200);
		});
	}, [result]);

	return (
		<div style={styles.wrapper}>
			<fieldset
				aria-label={t('pdfPanel.dropHint')}
				style={{
					...styles.dropZone,
					...(dragActive ? styles.dropZoneActive : {}),
					margin: 0,
					minWidth: 0,
				}}
				onDrop={handleDrop}
				onDragOver={(e) => {
					e.preventDefault();
					setDragActive(true);
				}}
				onDragLeave={() => setDragActive(false)}
			>
				<input type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} id="pdf-file-input" onChange={handleFileSelect} />
				<label htmlFor="pdf-file-input" style={{ cursor: 'pointer' }}>
					<div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
					<div>{t('pdfPanel.dropHint')}</div>
					<div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>{t('pdfPanel.clickToSelect')}</div>
				</label>
			</fieldset>

			{state.files.length > 0 && (
				<Card variant="default" padding="sm">
					<div style={styles.fileList}>
						<div style={styles.label}>{t('pdfPanel.files')} ({state.files.length})</div>
						{state.files.map((file) => (
							<div key={file.id} style={styles.fileItem}>
								<div>
									<div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--halo-text)' }}>📄 {file.name}</div>
									<div style={{ fontSize: '10px', color: 'var(--halo-text-muted)' }}>{file.pageCount} {t('pdfPanel.pages')} • {formatSize(file.size)}</div>
								</div>
								<button type="button" onClick={() => handleRemoveFile(file.id)} style={{ padding: '4px 8px', background: 'transparent', border: 'none', fontSize: '14px', cursor: 'pointer', opacity: 0.6 }}>✕</button>
							</div>
						))}
					</div>
				</Card>
			)}

			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
					<div style={styles.label}>{t('pdfPanel.operation')}</div>
					<div style={styles.opGrid}>
						{OPERATIONS.map((op) => (
							<button type="button" key={op.id} style={{ ...styles.opBtn, ...(state.selectedOperation === op.id ? styles.opActive : {}) }} onClick={() => handleSelectOp(op.id)}>
								<span style={{ fontSize: '20px' }}>{op.icon}</span><span>{t(`pdfPanel.ops.${op.id}`)}</span>
							</button>
						))}
					</div>
				</div>
			</Card>

			<ConfigPanel operation={state.selectedOperation} config={config} setConfig={setConfig} t={t} />

			{state.error && <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>⚠️ {state.error}</div>}
			{result.map((part) => (
				<div key={part.name} style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', fontSize: '12px', color: '#22c55e' }}>✅ {t('pdfPanel.ready')} - {part.name} ({formatSize(part.blob.size)})</div>
			))}

			<div style={{ display: 'flex', gap: '8px' }}>
				{result.length > 0 ? (
					<button type="button" style={styles.actionBtn} onClick={handleDownload}>⬇️ {t('pdfPanel.buttons.download')}</button>
				) : (
					<button type="button" style={{ ...styles.actionBtn, ...(canExecute ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }} onClick={handleExecute} disabled={!canExecute}>
						{state.processing ? `⏳ ${t('pdfPanel.buttons.processing')}` : `▶️ ${t('pdfPanel.process')}`}
					</button>
				)}
			</div>

			<div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--halo-text-muted)' }}>🔒 {t('pdfPanel.localOnly')}</div>
		</div>
	);
};
