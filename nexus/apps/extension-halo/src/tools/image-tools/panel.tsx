// goal: Image Tools panel UI - compress, convert, and base64 encode images

import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ImageFormat, ImageConfig, ImageInfo } from './types';
import { imageToBase64, formatSize, DEFAULT_CONFIG, imageToolsConfigCodec } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { downloadBlob, ObjectUrlSlot } from '../../kernel/utils/object-url-lease';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import { IMAGE_TASK_DEADLINE_MS, IMAGE_WORKER_PATH, type ImageWorkerRequest, type ImageWorkerResponse } from './worker-contract';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp'];

export const ImageToolsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig, , configRecovery] = useToolState<ImageConfig>('image-tools', DEFAULT_CONFIG, { codec: imageToolsConfigCodec });

	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<string>('');
	const [info, setInfo] = useState<ImageInfo | null>(null);
	const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const previewSlot = useRef<ObjectUrlSlot | null>(null);
	if (!previewSlot.current) previewSlot.current = new ObjectUrlSlot();
	const task = useOwnedAsyncTask();
	const workerFactory = useMemo(() => extensionWorkerFactory(IMAGE_WORKER_PATH), []);
	const runWorker = useCallback((request: ImageWorkerRequest) => task.run(
		() => oneShotWorker<ImageWorkerRequest, ImageWorkerResponse>(workerFactory, request),
		IMAGE_TASK_DEADLINE_MS,
	), [task.run, workerFactory]);
	useEffect(() => () => previewSlot.current?.clear(), []);
	const setOwnedConfig = useCallback<React.Dispatch<React.SetStateAction<ImageConfig>>>((next) => {
		task.cancel();
		setResult(null);
		setConfig(next);
	}, [setConfig, task.cancel]);

	// Handle file selection
	const handleFile = useCallback(async (f: File) => {
		setResult(null);
		setError(null);
		const outcome = await runWorker({ type: 'inspect', file: f });
		if (outcome.kind !== 'succeeded') return;
		if (outcome.value.ok === false) { setError(outcome.value.error); return; }
		if (outcome.value.type !== 'inspect') return;
		setFile(f);
		setPreview(previewSlot.current?.replace(f) ?? '');
		setInfo(outcome.value.info);
	}, [runWorker]);

	// Process image
	const handleProcess = useCallback(async () => {
		if (!file) return;
		setError(null);
		const frozenConfig = structuredClone(config);
		const name = file.name.replace(/\.[^.]+$/, `.${frozenConfig.format}`);
		const outcome = await runWorker({ type: 'process', file, config: frozenConfig });
		if (outcome.kind !== 'succeeded') return;
		if (outcome.value.ok === false) { setError(outcome.value.error); return; }
		if (outcome.value.type === 'process') setResult({ blob: outcome.value.blob, name });
	}, [file, config, runWorker]);

	// Download result
	const handleDownload = useCallback(() => {
		if (result) downloadBlob(result.blob, result.name);
	}, [result]);

	// Copy base64
	const handleCopyBase64 = useCallback(async () => {
		if (!result) return;
		const outcome = await task.run(() => imageToBase64(result.blob));
		if (outcome.kind === 'succeeded') await navigator.clipboard.writeText(outcome.value);
	}, [result, task.run]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={configRecovery} emptyValue={DEFAULT_CONFIG} exportName="halo-image-config-damaged.json" />
			{/* Dropzone */}
			<label
				style={styles.dropzone}
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
			>
				<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
				📷 {t('imageTools.dropHint')}
			</label>

			{/* Preview */}
			{preview && info && (
				<div style={styles.preview}>
					<img src={preview} alt="preview" style={styles.img} />
					<div style={styles.info}>
						<div><strong>{file?.name}</strong></div>
						<div>{info.width} × {info.height}</div>
						<div>{formatSize(info.size)}</div>
						<div>{info.type}</div>
					</div>
				</div>
			)}

			{/* Config */}
			{file && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<span style={styles.label}>{t('imageTools.format')}</span>
						<select style={styles.select} value={config.format} onChange={(e) => setOwnedConfig((c) => ({ ...c, format: e.target.value as ImageFormat }))}>
							{FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
						</select>
					</div>
					<div style={{ ...styles.slider, marginTop: '12px' }}>
						<span style={styles.label}>{t('imageTools.quality')}</span>
						<input type="range" min={0.1} max={1} step={0.1} value={config.quality} onChange={(e) => setOwnedConfig((c) => ({ ...c, quality: parseFloat(e.target.value) }))} style={{ flex: 1 }} />
						<span style={{ ...styles.label, width: '40px', textAlign: 'right' }}>{Math.round(config.quality * 100)}%</span>
					</div>
				</Card>
			)}

			{/* Actions */}
			{file && (
				<div style={styles.row}>
					<button type="button" style={styles.btn} onClick={task.phase === 'running' ? task.cancel : handleProcess}>
						{task.phase === 'running' ? '✕ Cancel' : `✨ ${t('imageTools.process')}`}
					</button>
				</div>
			)}
			{(error !== null || task.error !== null) && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{error ?? String(task.error)}</div>}

			{/* Result */}
			{result && info && (
				<div style={styles.result}>
					<div style={styles.row}>
						<span>{formatSize(info.size)} → {formatSize(result.blob.size)}</span>
						<span style={styles.savings}>
							{Math.round((1 - result.blob.size / info.size) * 100)}% {t('imageTools.saved')}
						</span>
					</div>
					<div style={{ ...styles.row, marginTop: '12px' }}>
						<button type="button" style={styles.btn} onClick={handleDownload}>💾 {t('imageTools.download')}</button>
						<button type="button" style={styles.btnSecondary} onClick={handleCopyBase64}>📋 Base64</button>
					</div>
				</div>
			)}
		</div>
	);
};
