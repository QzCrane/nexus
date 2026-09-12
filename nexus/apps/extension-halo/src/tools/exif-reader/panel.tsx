// goal: EXIF Reader panel UI - display image metadata

import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { ExifData } from './types';
import { formatFileSize } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { ObjectUrlSlot } from '../../kernel/utils/object-url-lease';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import { IMAGE_TASK_DEADLINE_MS, IMAGE_WORKER_PATH, type ImageWorkerRequest, type ImageWorkerResponse } from '../image-tools/worker-contract';


export const ExifReaderPanel: React.FC = () => {
	const { t } = useTranslation();
	const [exif, setExif] = useState<ExifData | null>(null);
	const [preview, setPreview] = useState<string>('');
	const [fileName, setFileName] = useToolState<string>('exif-reader', '');

	const [fileSize, setFileSize] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const previewSlot = useRef<ObjectUrlSlot | null>(null);
	if (!previewSlot.current) previewSlot.current = new ObjectUrlSlot();
	const task = useOwnedAsyncTask();
	const workerFactory = useMemo(() => extensionWorkerFactory(IMAGE_WORKER_PATH), []);
	useEffect(() => () => previewSlot.current?.clear(), []);

	// Process file
	const processFile = useCallback(async (file: File) => {
		setError(null);
		const request: ImageWorkerRequest = { type: 'exif', file };
		const outcome = await task.run(
			() => oneShotWorker<ImageWorkerRequest, ImageWorkerResponse>(workerFactory, request),
			IMAGE_TASK_DEADLINE_MS,
		);
		if (outcome.kind !== 'succeeded') return;
		if (outcome.value.ok === false) { setError(outcome.value.error); return; }
		if (outcome.value.type !== 'exif') return;
		setFileName(file.name);
		setFileSize(file.size);
		setPreview(previewSlot.current?.replace(file) ?? '');
		setExif(outcome.value.data);
	}, [setFileName, task.run, workerFactory]);

	// Handle drop
	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) processFile(file);
	}, [processFile]);

	// Handle file select
	const handleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) processFile(file);
	}, [processFile]);

	// Data fields
	const fields = exif ? [
		{ id: 'make', label: t('exifReader.make'), value: exif.make },
		{ id: 'model', label: t('exifReader.model'), value: exif.model },
		{ id: 'date-time', label: t('exifReader.dateTime'), value: exif.dateTime },
		{ id: 'software', label: t('exifReader.software'), value: exif.software },
		{ id: 'dimensions', label: t('exifReader.dimensions'), value: exif.width && exif.height ? `${exif.width} × ${exif.height}` : undefined },
		{ id: 'file-size', label: t('exifReader.fileSize'), value: formatFileSize(fileSize) },
	].filter((f) => f.value) : [];

	return (
		<div style={styles.wrapper}>
			{/* Dropzone */}
			<label
				style={{ ...styles.dropzone, ...(isDragging ? styles.dropzoneActive : {}) }}
				onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
				onDragLeave={() => setIsDragging(false)}
				onDrop={handleDrop}
			>
				{preview ? (
					<img src={preview} alt="Preview" style={styles.preview} />
				) : (
					<div style={styles.empty}>📷 {t('exifReader.dropHere')}</div>
				)}
				<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSelect} />
			</label>
			{(error !== null || task.error !== null) && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{error ?? String(task.error)}</div>}

			{/* File Name */}
			{fileName && <div style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{fileName}</div>}

			{/* EXIF Data */}
			{fields.length > 0 ? (
				<div style={styles.grid}>
					{fields.map((f) => (
						<div key={f.id} style={styles.item}>
							<span style={styles.label}>{f.label}</span>
							<span style={styles.value}>{f.value}</span>
						</div>
					))}
				</div>
			) : exif && (
				<div style={{ ...styles.empty, textAlign: 'center', padding: '16px' }}>
					{t('exifReader.noExif')}
				</div>
			)}
		</div>
	);
};
