// goal: Color Picker tool panel UI with i18n support

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
} from './core';

const logger = createLogger('ColorPicker', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	pickerRow: {
		display: 'flex',
		gap: '10px',
		alignItems: 'center',
	},
	colorInput: {
		width: '60px',
		height: '44px',
		border: '2px solid var(--halo-border, #444)',
		borderRadius: '10px',
		cursor: 'pointer',
		padding: 0,
		background: 'transparent',
		transition: 'border-color 0.2s',
	},
	textInput: {
		flex: 1,
		padding: '12px 14px',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		background: 'var(--halo-bg-secondary, #252525)',
		color: 'var(--halo-text, #fff)',
		fontSize: '13px',
		fontFamily: 'monospace',
		outline: 'none',
		transition: 'border-color 0.2s, box-shadow 0.2s',
	},
	preview: {
		width: '100%',
		height: '90px',
		borderRadius: '12px',
		border: '1px solid var(--halo-border, #444)',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontSize: '16px',
		fontWeight: 600,
		letterSpacing: '0.5px',
		transition: 'background 0.2s',
		boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
	},
	valuesGrid: {
		display: 'grid',
		gridTemplateColumns: '1fr 1fr 1fr',
		gap: '10px',
	},
	valueBox: {
		background: 'var(--halo-bg-secondary, #252525)',
		borderRadius: '10px',
		padding: '12px',
		textAlign: 'center',
		cursor: 'pointer',
		transition: 'all 0.15s',
		border: '1px solid transparent',
	},
	valueLabel: {
		fontSize: '10px',
		color: 'var(--halo-text-muted, #666)',
		marginBottom: '6px',
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
		fontWeight: 500,
	},
	valueText: {
		fontSize: '12px',
		color: 'var(--halo-text-secondary, #ddd)',
		fontFamily: 'monospace',
	},
	historySection: {
		marginTop: '4px',
	},
	historyTitle: {
		fontSize: '11px',
		color: 'var(--halo-text-muted, #888)',
		marginBottom: '8px',
		fontWeight: 500,
	},
	historyGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(10, 1fr)',
		gap: '6px',
	},
	historySwatch: {
		aspectRatio: '1',
		borderRadius: '6px',
		border: '2px solid transparent',
		cursor: 'pointer',
		transition: 'transform 0.15s, border-color 0.2s',
		boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
	},
	empty: {
		padding: '20px',
		textAlign: 'center',
		color: 'var(--halo-text-muted, #666)',
		fontSize: '12px',
	},
	toast: {
		position: 'fixed',
		bottom: '60px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '24px',
		fontSize: '12px',
		fontWeight: 500,
		color: '#fff',
		zIndex: 1000,
		boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
		animation: 'fadeInUp 0.3s ease-out',
	},
};

// inv: determine text color based on background luminance
function getContrastColor(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.5 ? '#000000' : '#ffffff';
}

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
		showToast(ok ? t('colorPanel.copied') : 'Copy failed');
	}, [showToast, t]);

	const handleHistoryClick = useCallback((hex: string) => {
		handleColorChange(hex);
	}, [handleColorChange]);

	const rgbStr = `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
	const hslStr = `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`;

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
						placeholder="#hex or rgb(...)"
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
					title="Click to copy"
				>
					<div style={styles.valueLabel}>HEX</div>
					<div style={styles.valueText}>{color.hex}</div>
				</div>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(rgbStr, 'RGB')}
					title="Click to copy"
				>
					<div style={styles.valueLabel}>RGB</div>
					<div style={styles.valueText}>{color.rgb.r}, {color.rgb.g}, {color.rgb.b}</div>
				</div>
				<div
					style={styles.valueBox}
					onClick={() => handleCopyValue(hslStr, 'HSL')}
					title="Click to copy"
				>
					<div style={styles.valueLabel}>HSL</div>
					<div style={styles.valueText}>{color.hsl.h}°, {color.hsl.s}%, {color.hsl.l}%</div>
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
