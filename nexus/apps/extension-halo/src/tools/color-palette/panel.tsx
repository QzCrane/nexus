// goal: Color Palette panel UI - extract colors from images

import type React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { ColorInfo } from './types';
import { colorPaletteCodec, getContrastColor } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { ObjectUrlSlot } from '../../kernel/utils/object-url-lease';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import { IMAGE_TASK_DEADLINE_MS, IMAGE_WORKER_PATH, type ImageWorkerRequest, type ImageWorkerResponse } from '../image-tools/worker-contract';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const ColorPalettePanel: React.FC = () => {
	const { t } = useTranslation();
	const [colors, setColors, , colorsRecovery] = useToolState<ColorInfo[]>('color-palette', [], { codec: colorPaletteCodec });
	const [preview, setPreview] = useState<string>('');
	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const previewSlot = useRef<ObjectUrlSlot | null>(null);
	if (!previewSlot.current) previewSlot.current = new ObjectUrlSlot();
	const task = useOwnedAsyncTask();
	const workerFactory = useMemo(() => extensionWorkerFactory(IMAGE_WORKER_PATH), []);
	useEffect(() => () => previewSlot.current?.clear(), []);


	// Process image
	const processImage = useCallback(async (file: File) => {
		setError(null);
		const request: ImageWorkerRequest = { type: 'palette', file, maxColors: 8 };
		const outcome = await task.run(
			() => oneShotWorker<ImageWorkerRequest, ImageWorkerResponse>(workerFactory, request),
			IMAGE_TASK_DEADLINE_MS,
		);
		if (outcome.kind !== 'succeeded') return;
		if (outcome.value.ok === false) { setError(outcome.value.error); return; }
		if (outcome.value.type !== 'palette') return;
		setPreview(previewSlot.current?.replace(file) ?? '');
		setColors(outcome.value.colors);
	}, [setColors, task.run, workerFactory]);

	// Handle drop
	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) processImage(file);
	}, [processImage]);

	// Handle file select
	const handleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) processImage(file);
	}, [processImage]);

	// Copy color
	const handleCopy = useCallback((hex: string) => {
		navigator.clipboard.writeText(hex);
	}, []);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={colorsRecovery} emptyValue={[]} exportName="halo-color-palette-damaged.json" />
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
					<div style={styles.empty}>🎨 {t('colorPalette.dropHere')}</div>
				)}
				<input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSelect} />
			</label>
			{(error !== null || task.error !== null) && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{error ?? String(task.error)}</div>}

			{/* Palette */}
			{colors.length > 0 && (
				<div style={styles.palette}>
					{colors.map((color) => (
						<button
							type="button"
							key={color.hex}
							style={{ ...styles.colorRow, padding: 0, border: 'none', background: 'transparent', textAlign: 'left' }}
							onClick={() => handleCopy(color.hex)}
						>
							<span style={{ ...styles.colorSwatch, background: color.hex, color: getContrastColor(color.hex) }}>
								{color.percentage}%
							</span>
							<span style={styles.colorInfo}>
								<span style={{ ...styles.hex, display: 'block' }}>{color.hex.toUpperCase()}</span>
								<span style={{ ...styles.rgb, display: 'block' }}>{color.rgb}</span>
								<span style={{ ...styles.bar, display: 'block' }}>
									<span style={{ ...styles.barFill, width: `${color.percentage}%`, background: color.hex, display: 'block' }} />
								</span>
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
};
