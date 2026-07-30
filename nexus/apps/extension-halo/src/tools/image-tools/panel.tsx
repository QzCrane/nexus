// goal: Image Tools panel UI - compress, convert, and base64 encode images

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ImageFormat, ImageConfig, ImageInfo } from './types';
import { loadImage, getImageInfo, processImage, imageToBase64, downloadBlob, formatSize, DEFAULT_CONFIG } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp'];

export const ImageToolsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<ImageConfig>('image-tools', DEFAULT_CONFIG);

	const [file, setFile] = useState<File | null>(null);
	const [img, setImg] = useState<HTMLImageElement | null>(null);
	const [info, setInfo] = useState<ImageInfo | null>(null);
	const [result, setResult] = useState<{ blob: Blob; base64: string } | null>(null);
	const [processing, setProcessing] = useState(false);

	// Handle file selection
	const handleFile = useCallback(async (f: File) => {
		setFile(f);
		setResult(null);
		const loadedImg = await loadImage(f);
		setImg(loadedImg);
		setInfo(getImageInfo(f, loadedImg));
	}, []);

	// Process image
	const handleProcess = useCallback(async () => {
		if (!img) return;
		setProcessing(true);
		try {
			const blob = await processImage(img, config);
			const base64 = await imageToBase64(blob);
			setResult({ blob, base64 });
		} finally {
			setProcessing(false);
		}
	}, [img, config]);

	// Download result
	const handleDownload = useCallback(() => {
		if (!result || !file) return;
		const ext = config.format;
		const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
		downloadBlob(result.blob, name);
	}, [result, file, config.format]);

	// Copy base64
	const handleCopyBase64 = useCallback(() => {
		if (result) navigator.clipboard.writeText(result.base64);
	}, [result]);

	return (
		<div style={styles.wrapper}>
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
			{img && info && (
				<div style={styles.preview}>
					<img src={img.src} alt="preview" style={styles.img} />
					<div style={styles.info}>
						<div><strong>{file?.name}</strong></div>
						<div>{info.width} × {info.height}</div>
						<div>{formatSize(info.size)}</div>
						<div>{info.type}</div>
					</div>
				</div>
			)}

			{/* Config */}
			{img && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<span style={styles.label}>{t('imageTools.format')}</span>
						<select style={styles.select} value={config.format} onChange={(e) => setConfig((c) => ({ ...c, format: e.target.value as ImageFormat }))}>
							{FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
						</select>
					</div>
					<div style={{ ...styles.slider, marginTop: '12px' }}>
						<span style={styles.label}>{t('imageTools.quality')}</span>
						<input type="range" min={0.1} max={1} step={0.1} value={config.quality} onChange={(e) => setConfig((c) => ({ ...c, quality: parseFloat(e.target.value) }))} style={{ flex: 1 }} />
						<span style={{ ...styles.label, width: '40px', textAlign: 'right' }}>{Math.round(config.quality * 100)}%</span>
					</div>
				</Card>
			)}

			{/* Actions */}
			{img && (
				<div style={styles.row}>
					<button type="button" style={styles.btn} onClick={handleProcess} disabled={processing}>
						{processing ? '⏳' : '✨'} {t('imageTools.process')}
					</button>
				</div>
			)}

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
