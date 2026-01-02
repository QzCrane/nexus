// goal: EXIF Reader panel UI - display image metadata

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { ExifData } from './types';
import { parseExif, readFileAsArrayBuffer, formatFileSize } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const ExifReaderPanel: React.FC = () => {
	const { t } = useTranslation();
	const [exif, setExif] = useState<ExifData | null>(null);
	const [preview, setPreview] = useState<string>('');
	const [fileName, setFileName] = useToolState<string>('exif-reader', '');

	const [fileSize, setFileSize] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Process file
	const processFile = useCallback(async (file: File) => {
		if (!file.type.startsWith('image/')) return;

		setFileName(file.name);
		setFileSize(file.size);
		setPreview(URL.createObjectURL(file));

		const buffer = await readFileAsArrayBuffer(file);
		const data = parseExif(buffer);
		setExif(data);
	}, []);

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
		{ label: t('exifReader.make'), value: exif.make },
		{ label: t('exifReader.model'), value: exif.model },
		{ label: t('exifReader.dateTime'), value: exif.dateTime },
		{ label: t('exifReader.software'), value: exif.software },
		{ label: t('exifReader.dimensions'), value: exif.width && exif.height ? `${exif.width} × ${exif.height}` : undefined },
		{ label: t('exifReader.fileSize'), value: formatFileSize(fileSize) },
	].filter((f) => f.value) : [];

	return (
		<div style={styles.wrapper}>
			{/* Dropzone */}
			<div
				style={{ ...styles.dropzone, ...(isDragging ? styles.dropzoneActive : {}) }}
				onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
				onDragLeave={() => setIsDragging(false)}
				onDrop={handleDrop}
				onClick={() => inputRef.current?.click()}
			>
				{preview ? (
					<img src={preview} alt="Preview" style={styles.preview} />
				) : (
					<div style={styles.empty}>📷 {t('exifReader.dropHere')}</div>
				)}
				<input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSelect} />
			</div>

			{/* File Name */}
			{fileName && <div style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>{fileName}</div>}

			{/* EXIF Data */}
			{fields.length > 0 ? (
				<div style={styles.grid}>
					{fields.map((f, i) => (
						<div key={i} style={styles.item}>
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
