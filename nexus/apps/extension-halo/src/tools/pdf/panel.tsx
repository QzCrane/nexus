// goal: PDF Panel UI (main component)
// eff: Styles extracted to reduce file size

import type React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';

import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PDFDocument as PDFDoc, PDFOperation, PDFToolState } from './types';
import { ConfigPanel, DEFAULT_CONFIG, type OperationConfig } from './config-panel';
import { formatSize } from './utils';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { downloadBlob } from '../../kernel/utils/object-url-lease';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import {
	PDF_TASK_DEADLINE_MS,
	PDF_WORKER_PATH,
	type PDFWorkerRequest,
	type PDFWorkerResponse,
} from './worker-contract';
import { pdfConfigCodec, pdfOperationCodec } from './state-codecs';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


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
	const [selectedOperation, setSelectedOperation, , operationRecovery] = useToolState<PDFOperation | null>('pdf-op', null, { codec: pdfOperationCodec });
	const [state, setState] = useState<PDFToolState>({ files: [], selectedOperation: null, processing: false, error: null });
	const [config, setConfig, , configRecovery] = useToolState<OperationConfig>('pdf-config', DEFAULT_CONFIG, { codec: pdfConfigCodec });
	const task = useOwnedAsyncTask();

	// Sync selectedOperation to state for backward compatibility with component logic if needed,
	// but better to use it directly.
	useEffect(() => {
		setState(prev => ({ ...prev, selectedOperation }));
	}, [selectedOperation]);

	const [dragActive, setDragActive] = useState(false);
	const [result, setResult] = useState<{ blob: Blob; name: string }[]>([]);
	const workerFactory = useMemo(() => extensionWorkerFactory(PDF_WORKER_PATH), []);

	const runWorker = useCallback((request: PDFWorkerRequest) => task.run(
		() => oneShotWorker<PDFWorkerRequest, PDFWorkerResponse>(workerFactory, request),
		PDF_TASK_DEADLINE_MS,
	), [task.run, workerFactory]);
	const setOwnedConfig = useCallback<React.Dispatch<React.SetStateAction<OperationConfig>>>((next) => {
		task.cancel();
		setResult([]);
		setConfig(next);
	}, [setConfig, task.cancel]);

	const processFiles = useCallback(async (files: File[]) => {
		const outcome = await runWorker({ type: 'inspect', files: [...state.files.map((file) => file.file), ...files] });
		if (outcome.kind !== 'succeeded') return;
		const response = outcome.value;
		if (response.ok === false) {
			setState((prev) => ({ ...prev, error: response.error }));
			return;
		}
		if (response.type !== 'inspect') return;
		setResult([]);
		setState((prev) => ({ ...prev, files: response.files as PDFDoc[], error: null }));
	}, [runWorker, state.files]);

	const handleDrop = useCallback(async (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); await processFiles(Array.from(e.dataTransfer.files)); }, [processFiles]);
	const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => { await processFiles(Array.from(e.target.files || [])); e.target.value = ''; }, [processFiles]);
	const handleRemoveFile = useCallback((id: string) => {
		task.cancel();
		setResult([]);
		setState((prev) => ({ ...prev, files: prev.files.filter((f) => f.id !== id) }));
	}, [task.cancel]);
	const handleSelectOp = useCallback((op: PDFOperation) => { 
		task.cancel();
		setSelectedOperation(op);
		setResult([]);
		setState(prev => ({ ...prev, error: null }));
	}, [setSelectedOperation, task.cancel]);


	const canExecute = useMemo(() => {
		if (!state.selectedOperation || task.phase === 'running') return false;
		const op = OPERATIONS.find((o) => o.id === state.selectedOperation);
		return op ? state.files.length >= op.minFiles : false;
	}, [state.selectedOperation, state.files.length, task.phase]);

	const handleExecute = useCallback(async () => {
		if (!canExecute) return;
		setState((prev) => ({ ...prev, processing: true, error: null }));
		setResult([]);
		const { selectedOperation, files } = state;
			const firstFile = files[0];
			if (!selectedOperation || !firstFile) {
				setState((prev) => ({ ...prev, processing: false, error: 'Select an operation and at least one file' }));
				return;
			}
		const frozenConfig = structuredClone(config);
		const outcome = await runWorker({ type: 'execute', operation: selectedOperation, inputs: files, config: frozenConfig });
		if (outcome.kind !== 'succeeded') {
			setState((prev) => ({ ...prev, processing: false }));
			return;
		}
		const response = outcome.value;
		if (response.ok === false) {
			setState((prev) => ({ ...prev, processing: false, error: response.error }));
			return;
		}
		if (response.type !== 'execute') return;
		const baseName = {
			merge: 'merged', split: 'split', extract: 'extracted', rotate: 'rotated',
			watermark: 'watermarked', 'images-to-pdf': 'images', 'pdf-to-images': 'images',
		}[selectedOperation];
		setResult(response.outputs.map((part, index, all) => ({
			blob: new Blob([part], { type: 'application/pdf' }),
			name: all.length === 1 ? `${baseName}.pdf` : `${baseName}-${index + 1}.pdf`,
		})));
		setState((prev) => ({ ...prev, processing: false }));
	}, [state, config, canExecute, runWorker]);

	const handleDownload = useCallback(() => {
		// Sequential small delays keep multi-part downloads from being swallowed
		// by the browser's multiple-download guard.
		result.forEach((part, index) => {
			setTimeout(() => {
				downloadBlob(part.blob, part.name);
			}, index * 200);
		});
	}, [result]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={operationRecovery} emptyValue={null} exportName="halo-pdf-operation-damaged.json" />
			<StorageRecoveryActions recovery={configRecovery} emptyValue={DEFAULT_CONFIG} exportName="halo-pdf-config-damaged.json" />
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

			<ConfigPanel operation={state.selectedOperation} config={config} setConfig={setOwnedConfig} t={t} />

			{(state.error !== null || task.error !== null) && <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>⚠️ {state.error ?? String(task.error)}</div>}
			{result.map((part) => (
				<div key={part.name} style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: '8px', fontSize: '12px', color: '#22c55e' }}>✅ {t('pdfPanel.ready')} - {part.name} ({formatSize(part.blob.size)})</div>
			))}

			<div style={{ display: 'flex', gap: '8px' }}>
				{task.phase === 'running' ? (
					<button type="button" style={styles.actionBtn} onClick={task.cancel}>✕ Cancel</button>
				) : result.length > 0 ? (
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
