// goal: Color Picker tool panel UI with i18n support
// eff: Logic and styles extracted

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { ColorInfo } from './types';
import {
	parseColor,
	getColorInfo,
	copyToClipboard,
	saveToHistory,
	loadHistory,
	getContrast,
	hexToRgb,
} from './core';
import { styles } from './panel.styles';
import { getContrastColor } from './utils';

const logger = createLogger('ColorPicker', 'HALO');

export const ColorPickerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [color, setColor] = useState<ColorInfo>(getColorInfo('#7c3aed'));
	const [inputValue, setInputValue] = useState('#7c3aed');
	const [history, setHistory] = useState<string[]>([]);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadHistory().then(setHistory);
	}, []);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleColorChange = useCallback(async (hex: string) => {
		const info = getColorInfo(hex);
		setColor(info);
		setInputValue(hex);
		const updated = await saveToHistory(hex);
		setHistory(updated);
		logger.info('Color selected:', hex);
	}, []);

	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setInputValue(value);
		const parsed = parseColor(value);
		if (parsed) {
			setColor(parsed);
		}
	}, []);

	const handleInputBlur = useCallback(async () => {
		const parsed = parseColor(inputValue);
		if (parsed) {
			const updated = await saveToHistory(parsed.hex);
			setHistory(updated);
		}
	}, [inputValue]);

	const handleCopyValue = useCallback(async (value: string, label: string) => {
		const ok = await copyToClipboard(value);
		showToast(ok ? t('colorPanel.copied') : t('colorPanel.copyFailed'));
	}, [showToast, t]);

	const handleHistoryClick = useCallback((hex: string) => {
		handleColorChange(hex);
	}, [handleColorChange]);

	const rgbStr = `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
	const hslStr = `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`;
	const cmykStr = `cmyk(${color.cmyk.c}%, ${color.cmyk.m}%, ${color.cmyk.y}%, ${color.cmyk.k}%)`;

	const white = { r: 255, g: 255, b: 255 };
	const black = { r: 0, g: 0, b: 0 };
	const contrastWhite = getContrast(color.rgb, white);
	const contrastBlack = getContrast(color.rgb, black);

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="md">
				<div style={styles.pickerRow}>
					<input
						type="color"
						value={color.hex}
						onChange={(e) => handleColorChange(e.target.value)}
						style={styles.colorInput}
						title={t('colorPanel.pickFromPage')}
					/>
					<input
						type="text"
						value={inputValue}
						onChange={handleInputChange}
						onBlur={handleInputBlur}
						placeholder={t('colorPanel.inputPlaceholder')}
						style={styles.textInput}
					/>
				</div>
			</Card>

			<div
				style={{
					...styles.preview,
					background: color.hex,
					color: getContrastColor(color.hex),
				}}
			>
				{color.hex.toUpperCase()}
			</div>

			<div style={styles.valuesGrid}>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(color.hex, 'HEX')}
					title={t('colorPanel.clickToCopy')}
				>
					<div style={styles.valueLabel}>{t('colorPanel.hex')}</div>
					<div style={styles.valueText}>{color.hex.toUpperCase()}</div>
				</div>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(rgbStr, 'RGB')}
					title={t('colorPanel.clickToCopy')}
				>
					<div style={styles.valueLabel}>{t('colorPanel.rgb')}</div>
					<div style={styles.valueText}>{color.rgb.r}, {color.rgb.g}, {color.rgb.b}</div>
				</div>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(hslStr, 'HSL')}
					title={t('colorPanel.clickToCopy')}
				>
					<div style={styles.valueLabel}>{t('colorPanel.hsl')}</div>
					<div style={styles.valueText}>{color.hsl.h}, {color.hsl.s}%, {color.hsl.l}%</div>
				</div>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(cmykStr, 'CMYK')}
					title={t('colorPanel.clickToCopy')}
				>
					<div style={styles.valueLabel}>CMYK</div>
					<div style={styles.valueText}>{color.cmyk.c}, {color.cmyk.m}, {color.cmyk.y}, {color.cmyk.k}</div>
				</div>
			</div>

			{/* WCAG Contrast Section */}
			<div style={styles.contrastSection}>
				<div style={styles.contrastHeader}>
					<div style={styles.contrastTitle}>WCAG 2.1 Accessibility</div>
				</div>
				<div style={styles.contrastGrid}>
					<div style={styles.contrastBox}>
						<div style={styles.contrastLabel}>vs White (#FFF)</div>
						<div style={styles.contrastRatio}>{contrastWhite.ratio}:1</div>
						<div style={styles.contrastValue}>
							Large: <span style={contrastWhite.ratingAA === 'pass' ? styles.pass : styles.fail}>{contrastWhite.ratingAA.toUpperCase()}</span> | 
							Small: <span style={contrastWhite.ratingAAA === 'pass' ? styles.pass : styles.fail}>{contrastWhite.ratingAAA.toUpperCase()}</span>
						</div>
					</div>
					<div style={styles.contrastBox}>
						<div style={styles.contrastLabel}>vs Black (#000)</div>
						<div style={styles.contrastRatio}>{contrastBlack.ratio}:1</div>
						<div style={styles.contrastValue}>
							Large: <span style={contrastBlack.ratingAA === 'pass' ? styles.pass : styles.fail}>{contrastBlack.ratingAA.toUpperCase()}</span> | 
							Small: <span style={contrastBlack.ratingAAA === 'pass' ? styles.pass : styles.fail}>{contrastBlack.ratingAAA.toUpperCase()}</span>
						</div>
					</div>
				</div>
			</div>


			<div style={styles.historySection}>
				<div style={styles.historyTitle}>{t('colorPanel.history')}</div>
				{history.length > 0 ? (
					<div style={styles.historyGrid}>
						{history.slice(0, 20).map((hex, i) => (
							<div
								key={i}
								style={{ ...styles.historySwatch, background: hex }}
								onClick={() => handleHistoryClick(hex)}
								title={hex}
							/>
						))}
					</div>
				) : (
					<div style={styles.empty}>{t('colorPanel.noHistory')}</div>
				)}
			</div>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
