// goal: PDF Panel UI (main component)
// eff: Styles extracted to reduce file size

import React, { useState, useCallback, useMemo, useEffect } from 'react';

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
	const [selectedOperation, setSelectedOperation] = useToolState<PDFOperation | null>('pdf-op' as any, null);
	const [state, setState] = useState<PDFToolState>({ files: [], selectedOperation: null, processing: false, error: null });
	const [config, setConfig] = useToolState<OperationConfig>('pdf-config' as any, DEFAULT_CONFIG);

	// Sync selectedOperation to state for backward compatibility with component logic if needed,
	// but better to use it directly.
	useEffect(() => {
		setState(prev => ({ ...prev, selectedOperation }));
	}, [selectedOperation]);

	const [dragActive, setDragActive] = useState(false);
	const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

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
					validFiles.push({ id: crypto.randomUUID(), name: file.name, pageCount: pages, size: file.size, createdAt: Date.now(), data: buffer });
				}
			} else if (isImage) {
				validFiles.push({ id: crypto.randomUUID(), name: file.name, pageCount: 1, size: file.size, createdAt: Date.now(), data: buffer });
			}
		}
		if (validFiles.length > 0) setState((prev) => ({ ...prev, files: [...prev.files, ...validFiles], error: null }));
	};

	const handleDrop = useCallback(async (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); await processFiles(Array.from(e.dataTransfer.files)); }, []);
	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => { await processFiles(Array.from(e.target.files || [])); e.target.value = ''; }, []);
	const handleRemoveFile = useCallback((id: string) => setState((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) })), []);
	const handleSelectOp = useCallback((op: PDFOperation) => { 
		setSelectedOperation(op);
		setResult(null); 
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
		setResult(null);
		try {
			const { selectedOperation, files } = state;
			let output: ArrayBuffer | null = null;
			let outputName = 'output.pdf';

			if (selectedOperation === 'merge') {
				const res = await mergePDFs({ documents: files.map((f) => f.data) });
				if (res.success) { output = res.data; outputName = 'merged.pdf'; } else throw new Error(res.error);
			} else if (selectedOperation === 'split') {
				const ranges = parseRanges(config.splitRanges);
				if (ranges.length === 0) throw new Error('Invalid page ranges');
				const res = await splitPDF({ document: files[0]!.data, ranges });
				if (res.success) { output = res.data![0]!; outputName = 'split.pdf'; } else throw new Error(res.error);
			} else if (selectedOperation === 'extract') {
				const pages = parsePages(config.extractPages);
				if (pages.length === 0) throw new Error('Invalid page numbers');
				const res = await extractPages({ document: files[0]!.data, pages });
				if (res.success) { output = res.data; outputName = 'extracted.pdf'; } else throw new Error(res.error);
			} else if (selectedOperation === 'rotate') {
				const res = await rotatePages({ document: files[0]!.data, pages: [], degrees: config.rotateDegrees });
				if (res.success) { output = res.data; outputName = 'rotated.pdf'; } else throw new Error(res.error);
			} else if (selectedOperation === 'watermark') {
				const res = await addWatermark({ document: files[0]!.data, text: config.watermarkText, opacity: config.watermarkOpacity });
				if (res.success) { output = res.data; outputName = 'watermarked.pdf'; } else throw new Error(res.error);
			} else if (selectedOperation === 'images-to-pdf') {
				const res = await imagesToPDF({ images: files.map((f) => f.data), pageSize: config.pageSize });
				if (res.success) { output = res.data; outputName = 'images.pdf'; } else throw new Error(res.error);
			}
			if (output) setResult({ blob: new Blob([output], { type: 'application/pdf' }), name: outputName });
		} catch (err) {
			setState((prev) => ({ ...prev, error: (err as Error).message }));
		} finally {
			setState((prev) => ({ ...prev, processing: false }));
		}
	}, [state, config, canExecute]);

	const handleDownload = useCallback(() => {
		if (!result) return;
		const url = URL.createObjectURL(result.blob);
		const a = document.createElement('a'); a.href = url; a.download = result.name; a.click();
		URL.revokeObjectURL(url);
	}, [result]);

	return (
		<div style={styles.wrapper}>
			<div style={{ ...styles.dropZone, ...(dragActive ? styles.dropZoneActive : {}) }} onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)}>
				<input type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} id="pdf-file-input" onChange={handleFileSelect} />
				<label htmlFor="pdf-file-input" style={{ cursor: 'pointer' }}>
					<div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
					<div>{t('pdfPanel.dropHint')}</div>
					<div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>{t('pdfPanel.clickToSelect')}</div>
				</label>
			</div>

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
								<button onClick={() => handleRemoveFile(file.id)} style={{ padding: '4px 8px', background: 'transparent', border: 'none', fontSize: '14px', cursor: 'pointer', opacity: 0.6 }}>✕</button>
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
							<button key={op.id} style={{ ...styles.opBtn, ...(state.selectedOperation === op.id ? styles.opActive : {}) }} onClick={() => handleSelectOp(op.id)}>
								<span style={{ fontSize: '20px' }}>{op.icon}</span><span>{t(`pdfPanel.ops.${op.id}`)}</span>
							</button>
						))}
					</div>
				</div>
			</Card>

			<ConfigPanel operation={state.selectedOperation} config={config} setConfig={setConfig} t={t} />

			{state.error && <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>⚠️ {state.error}</div>}
			{result && <div style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', fontSize: '12px', color: '#22c55e' }}>✅ {t('pdfPanel.ready')} - {result.name} ({formatSize(result.blob.size)})</div>}

			<div style={{ display: 'flex', gap: '8px' }}>
				{result ? (
					<button style={styles.actionBtn} onClick={handleDownload}>⬇️ {t('pdfPanel.buttons.download')}</button>
				) : (
					<button style={{ ...styles.actionBtn, ...(canExecute ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }} onClick={handleExecute} disabled={!canExecute}>
						{state.processing ? `⏳ ${t('pdfPanel.buttons.processing')}` : `▶️ ${t('pdfPanel.process')}`}
					</button>
				)}
			</div>

			<div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--halo-text-muted)' }}>🔒 {t('pdfPanel.localOnly')}</div>
		</div>
	);
};
