// goal: dark mode control panel with full parameter exposure
// inv: all darkreader config options must be visible and adjustable

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { Card } from '@nexus/ui-kit';
import type { DarkModeConfig, DarkModeFixes } from './core';
import { DEFAULT_CONFIG, DEFAULT_FIXES, DARK_MODE_PRESETS, type DarkModePreset } from './core';

interface Props {
	config: Partial<DarkModeConfig>;
	fixes: Partial<DarkModeFixes>;
	onConfigChange: (config: Partial<DarkModeConfig>) => void;
	onFixesChange: (fixes: Partial<DarkModeFixes>) => void;
	onPresetSelect: (preset: DarkModePreset) => void;
}

// inv: all darkreader config options must be visible and adjustable
// Refactored to use t() inside component

// inv: slider component for numeric values
const Slider = ({ label, value, min, max, onChange }: {
	label: string; value: number; min: number; max: number;
	onChange: (v: number) => void;
}) => (
	<div style={{ marginBottom: '10px' }}>
		<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
			<span style={{ color: '#aaa' }}>{label}</span>
			<span style={{ color: '#fff', fontWeight: '500' }}>{value}</span>
		</div>
		<input
			type="range" min={min} max={max} value={value}
			onChange={(e) => onChange(Number(e.target.value))}
			style={{ width: '100%', height: '4px', cursor: 'pointer' }}
		/>
	</div>
);

// inv: color input for theme colors
const ColorInput = ({ label, value, onChange }: {
	label: string; value: string; onChange: (v: string) => void;
}) => (
	<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
		<input
			type="color" value={value}
			onChange={(e) => onChange(e.target.value)}
			style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
		/>
		<span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
	</div>
);

export const DarkModePanel: React.FC<Props> = ({
	config, fixes, onConfigChange, onFixesChange, onPresetSelect
}) => {
	const { t } = useTranslation();
	const [showAdvanced, setShowAdvanced] = useState(false);
	const mergedConfig = { ...DEFAULT_CONFIG, ...config };
	const mergedFixes = { ...DEFAULT_FIXES, ...fixes };

	const updateConfig = useCallback((key: keyof DarkModeConfig, value: number | string | boolean) => {
		onConfigChange({ ...config, [key]: value });
	}, [config, onConfigChange]);

	return (
		<Card variant="outlined" padding="sm">
			{/* Preset Buttons */}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '12px' }}>
				{(Object.keys(DARK_MODE_PRESETS) as DarkModePreset[]).map((key) => {
					const labels: Record<string, string> = {
						default: t('darkMode.presetDefault', { defaultValue: 'Default' }),
						highContrast: t('darkMode.presetHighContrast', { defaultValue: 'High Contrast' }),
						warm: t('darkMode.presetWarm', { defaultValue: 'Warm' }),
						dim: t('darkMode.presetDim', { defaultValue: 'Dim' }),
					};
					return (
					<button
						key={key}
						onClick={() => onPresetSelect(key)}
						style={{
							padding: '6px 4px', fontSize: '10px', fontWeight: '500',
							border: '1px solid #444', borderRadius: '4px',
							background: '#2a2a2a', color: '#ccc', cursor: 'pointer',
						}}
					>
						{labels[key]}
					</button>
					);
				})}
			</div>

			{/* Core Sliders */}
			<Slider label={t('darkMode.brightness', { defaultValue: 'Brightness' })} value={mergedConfig.brightness} min={50} max={150}
				onChange={(v) => updateConfig('brightness', v)} />
			<Slider label={t('darkMode.contrast', { defaultValue: 'Contrast' })} value={mergedConfig.contrast} min={50} max={150}
				onChange={(v) => updateConfig('contrast', v)} />
			<Slider label={t('darkMode.sepia', { defaultValue: 'Sepia' })} value={mergedConfig.sepia} min={0} max={100}
				onChange={(v) => updateConfig('sepia', v)} />
			<Slider label={t('darkMode.grayscale', { defaultValue: 'Grayscale' })} value={mergedConfig.grayscale} min={0} max={100}
				onChange={(v) => updateConfig('grayscale', v)} />

			{/* Advanced Toggle */}
			<button
				onClick={() => setShowAdvanced(!showAdvanced)}
				style={{
					width: '100%', padding: '8px', marginTop: '8px',
					fontSize: '11px', color: '#888', background: 'transparent',
					border: '1px dashed #444', borderRadius: '4px', cursor: 'pointer',
				}}
			>
				{showAdvanced ? `▲ ${t('darkMode.hideAdvanced', { defaultValue: 'Hide Advanced' })}` : `▼ ${t('darkMode.showAdvanced', { defaultValue: 'Show Advanced' })}`}
			</button>

			{/* Advanced Options */}
			{showAdvanced && (
				<div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333' }}>
					<div style={{ fontSize: '11px', fontWeight: '500', color: '#888', marginBottom: '10px' }}>
						{t('darkMode.themeColors', { defaultValue: 'Theme Colors' })}
					</div>
					<ColorInput label={t('darkMode.bgColor', { defaultValue: 'Background' })} value={mergedConfig.darkSchemeBackgroundColor}
						onChange={(v) => updateConfig('darkSchemeBackgroundColor', v)} />
					<ColorInput label={t('darkMode.textColor', { defaultValue: 'Text' })} value={mergedConfig.darkSchemeTextColor}
						onChange={(v) => updateConfig('darkSchemeTextColor', v)} />
					<ColorInput label={t('darkMode.scrollbarColor', { defaultValue: 'Scrollbar' })} value={mergedConfig.scrollbarColor}
						onChange={(v) => updateConfig('scrollbarColor', v)} />
					<ColorInput label={t('darkMode.selectionColor', { defaultValue: 'Selection' })} value={mergedConfig.selectionColor}
						onChange={(v) => updateConfig('selectionColor', v)} />

					<div style={{ fontSize: '11px', fontWeight: '500', color: '#888', margin: '12px 0 8px' }}>
						{t('darkMode.fixes', { defaultValue: 'Fixes (Site-Specific)' })}
					</div>
					<textarea
						placeholder={t('darkMode.cssPlaceholder', { defaultValue: 'Custom CSS (e.g., body { color: white !important; })' })}
						value={mergedFixes.css}
						onChange={(e) => onFixesChange({ ...fixes, css: e.target.value })}
						style={{
							width: '100%', height: '60px', fontSize: '10px',
							background: '#1a1a1a', color: '#ccc', border: '1px solid #444',
							borderRadius: '4px', padding: '8px', resize: 'vertical',
						}}
					/>
				</div>
			)}
		</Card>
	);
};
