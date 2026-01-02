// goal: Color Palette panel UI - extract colors from images

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { ColorInfo } from './types';
import { extractColorsFromImage, loadImageFromFile, getContrastColor } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const ColorPalettePanel: React.FC = () => {
	const { t } = useTranslation();
	const [colors, setColors] = useToolState<ColorInfo[]>('color-palette' as any, []);
	const [preview, setPreview] = useState<string>('');
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);


	// Process image
	const processImage = useCallback(async (file: File) => {
		if (!file.type.startsWith('image/')) return;

		setPreview(URL.createObjectURL(file));
		const img = await loadImageFromFile(file);
		const extracted = extractColorsFromImage(img, 8);
		setColors(extracted);
	}, []);

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
					<div style={styles.empty}>🎨 {t('colorPalette.dropHere')}</div>
				)}
				<input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSelect} />
			</div>

			{/* Palette */}
			{colors.length > 0 && (
				<div style={styles.palette}>
					{colors.map((color, i) => (
						<div key={i} style={styles.colorRow} onClick={() => handleCopy(color.hex)}>
							<div style={{ ...styles.colorSwatch, background: color.hex, color: getContrastColor(color.hex) }}>
								{color.percentage}%
							</div>
							<div style={styles.colorInfo}>
								<div style={styles.hex}>{color.hex.toUpperCase()}</div>
								<div style={styles.rgb}>{color.rgb}</div>
								<div style={styles.bar}>
									<div style={{ ...styles.barFill, width: `${color.percentage}%`, background: color.hex }} />
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
};
