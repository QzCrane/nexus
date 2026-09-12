// goal: Color Picker tool panel UI with i18n support
// eff: Logic and styles extracted

import type React from 'react';
import { useCallback, useMemo } from 'react';

import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import {
	parseColor,
	getColorInfo,
	copyToClipboard,
	getContrast,
	colorHistoryCodec,
} from './core';
import { styles } from './panel.styles';
import { getContrastColor } from './utils';
import { useToolState } from '../../kernel';
import { useToast } from '../../components/ToastProvider';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


const logger = createLogger('ColorPicker', 'HALO');

export const ColorPickerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [inputValue, setInputValue] = useToolState<string>('color-picker', '#7c3aed');
	const color = useMemo(() => getColorInfo(inputValue), [inputValue]);
	const [history, setHistory, , historyRecovery] = useToolState<string[]>('color-history', [], { codec: colorHistoryCodec });

	const handleColorChange = useCallback(async (hex: string) => {
		setInputValue(hex);
		if (!history.includes(hex)) {
			setHistory([hex, ...history.slice(0, 19)]);
		}
		logger.info('Color selected:', hex);
	}, [history, setHistory, setInputValue]);


	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
	}, [setInputValue]);


	const handleInputBlur = useCallback(async () => {
		const parsed = parseColor(inputValue);
		if (parsed && !history.includes(parsed.hex)) {
			setHistory([parsed.hex, ...history.slice(0, 19)]);
		}
	}, [inputValue, history, setHistory]);


	const handleCopyValue = useCallback(async (value: string, _label: string) => {
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
			<StorageRecoveryActions recovery={historyRecovery} emptyValue={[]} exportName="halo-color-history-damaged.json" />
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
				<button
					type="button"
					style={{ ...styles.valueBox, color: 'inherit' }}
					onClick={() => handleCopyValue(color.hex, 'HEX')}
					title={t('colorPanel.clickToCopy')}
				>
					<span style={{ ...styles.valueLabel, display: 'block' }}>{t('colorPanel.hex')}</span>
					<span style={{ ...styles.valueText, display: 'block' }}>{color.hex.toUpperCase()}</span>
				</button>
				<button
					type="button"
					style={{ ...styles.valueBox, color: 'inherit' }}
					onClick={() => handleCopyValue(rgbStr, 'RGB')}
					title={t('colorPanel.clickToCopy')}
				>
					<span style={{ ...styles.valueLabel, display: 'block' }}>{t('colorPanel.rgb')}</span>
					<span style={{ ...styles.valueText, display: 'block' }}>{color.rgb.r}, {color.rgb.g}, {color.rgb.b}</span>
				</button>
				<button
					type="button"
					style={{ ...styles.valueBox, color: 'inherit' }}
					onClick={() => handleCopyValue(hslStr, 'HSL')}
					title={t('colorPanel.clickToCopy')}
				>
					<span style={{ ...styles.valueLabel, display: 'block' }}>{t('colorPanel.hsl')}</span>
					<span style={{ ...styles.valueText, display: 'block' }}>{color.hsl.h}, {color.hsl.s}%, {color.hsl.l}%</span>
				</button>
				<button
					type="button"
					style={{ ...styles.valueBox, color: 'inherit' }}
					onClick={() => handleCopyValue(cmykStr, 'CMYK')}
					title={t('colorPanel.clickToCopy')}
				>
					<span style={{ ...styles.valueLabel, display: 'block' }}>CMYK</span>
					<span style={{ ...styles.valueText, display: 'block' }}>{color.cmyk.c}, {color.cmyk.m}, {color.cmyk.y}, {color.cmyk.k}</span>
				</button>
			</div>

			{/* WCAG Contrast Section */}
			<div style={styles.contrastSection}>
				<div style={styles.contrastHeader}>
					<div style={styles.contrastTitle}>{t('colorPanel.wcagTitle', { defaultValue: 'WCAG 2.1 Accessibility' })}</div>
				</div>
				<div style={styles.contrastGrid}>
					<div style={styles.contrastBox}>
						<div style={styles.contrastLabel}>{t('colorPanel.vsWhite', { defaultValue: 'vs White (#FFF)' })}</div>
						<div style={styles.contrastRatio}>{contrastWhite.ratio}:1</div>
						<div style={styles.contrastValue}>
							{t('colorPanel.largeText', { defaultValue: 'Large' })}: <span style={contrastWhite.ratingAA === 'pass' ? styles.pass : styles.fail}>{contrastWhite.ratingAA.toUpperCase()}</span> | 
							{t('colorPanel.smallText', { defaultValue: 'Small' })}: <span style={contrastWhite.ratingAAA === 'pass' ? styles.pass : styles.fail}>{contrastWhite.ratingAAA.toUpperCase()}</span>
						</div>
					</div>
					<div style={styles.contrastBox}>
						<div style={styles.contrastLabel}>{t('colorPanel.vsBlack', { defaultValue: 'vs Black (#000)' })}</div>
						<div style={styles.contrastRatio}>{contrastBlack.ratio}:1</div>
						<div style={styles.contrastValue}>
							{t('colorPanel.largeText', { defaultValue: 'Large' })}: <span style={contrastBlack.ratingAA === 'pass' ? styles.pass : styles.fail}>{contrastBlack.ratingAA.toUpperCase()}</span> | 
							{t('colorPanel.smallText', { defaultValue: 'Small' })}: <span style={contrastBlack.ratingAAA === 'pass' ? styles.pass : styles.fail}>{contrastBlack.ratingAAA.toUpperCase()}</span>
						</div>
					</div>
				</div>
			</div>


			<div style={styles.historySection}>
				<div style={styles.historyTitle}>{t('colorPanel.history')}</div>
				{history.length > 0 ? (
					<div style={styles.historyGrid}>
						{history.slice(0, 20).map((hex) => (
							<button
								type="button"
								key={hex}
								aria-label={hex}
								style={{ ...styles.historySwatch, background: hex, padding: 0 }}
								onClick={() => handleHistoryClick(hex)}
								title={hex}
							/>
						))}
					</div>
				) : (
					<div style={styles.empty}>{t('colorPanel.noHistory')}</div>
				)}
			</div>
		</div>
	);
};
