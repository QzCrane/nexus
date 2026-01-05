// goal: dark mode control panel with full parameter exposure
// inv: all darkreader config options must be visible and adjustable

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../../../i18n';
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
	<div style={{ marginBottom: '16px' }}>
		<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
			<span style={{ color: 'var(--halo-text-secondary)', fontWeight: 500 }}>{label}</span>
			<span style={{ color: 'var(--halo-text)', fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
		</div>
		<div style={{ position: 'relative', height: '6px', width: '100%', display: 'flex', alignItems: 'center' }}>
			<input
				type="range" min={min} max={max} value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={{
					width: '100%', height: '4px', cursor: 'pointer', appearance: 'none',
					background: 'var(--halo-bg-tertiary)', borderRadius: '2px', outline: 'none',
				}}
				className="halo-range"
			/>
			<style>{`
				.halo-range::-webkit-slider-thumb {
					-webkit-appearance: none; appearance: none;
					width: 14px; height: 14px; border-radius: 50%;
					background: var(--halo-accent);
					box-shadow: 0 0 0 2px var(--halo-bg), 0 2px 4px rgba(0,0,0,0.1);
					cursor: pointer; transition: transform 0.1s;
				}
				.halo-range::-webkit-slider-thumb:hover { transform: scale(1.1); }
				.halo-range::-webkit-slider-thumb:active { transform: scale(0.95); }
			`}</style>
		</div>
	</div>
);

// inv: color input for theme colors
const ColorInput = ({ label, value, onChange }: {
	label: string; value: string; onChange: (v: string) => void;
}) => (
	<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '4px 0' }}>
		<div style={{ 
			width: '32px', height: '32px', borderRadius: '8px', overflow: 'hidden', 
			border: '1px solid var(--halo-border)', position: 'relative',
			boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
		}}>
			<input
				type="color" value={value}
				onChange={(e) => onChange(e.target.value)}
				style={{ 
					width: '150%', height: '150%', border: 'none', padding: 0, margin: '-25%', 
					cursor: 'pointer', background: 'none' 
				}}
			/>
		</div>
		<span style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', fontWeight: 500 }}>{label}</span>
		<span style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', color: 'var(--halo-text-muted)' }}>
			{value.toUpperCase()}
		</span>
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
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
				{(Object.keys(DARK_MODE_PRESETS) as DarkModePreset[]).map((key) => {
					const labels: Record<string, string> = {
						default: t('darkMode.presetDefault', { defaultValue: 'Default' }),
						highContrast: t('darkMode.presetHighContrast', { defaultValue: 'High Contrast' }),
						warm: t('darkMode.presetWarm', { defaultValue: 'Warm' }),
						dim: t('darkMode.presetDim', { defaultValue: 'Dim' }),
					};
					// Simple heuristic to check if current config roughly matches preset
					const isSelected = mergedConfig.brightness === DARK_MODE_PRESETS[key].brightness && 
									   mergedConfig.contrast === DARK_MODE_PRESETS[key].contrast &&
									   mergedConfig.sepia === DARK_MODE_PRESETS[key].sepia;

					return (
					<button
						key={key}
						onClick={() => onPresetSelect(key)}
						style={{
							padding: '6px 12px', fontSize: '11px', fontWeight: 600,
							border: isSelected ? '1px solid var(--halo-accent)' : '1px solid var(--halo-border)', 
							borderRadius: '20px',
							background: isSelected ? 'var(--halo-accent-alpha, rgba(99, 102, 241, 0.15))' : 'transparent', 
							color: isSelected ? 'var(--halo-accent)' : 'var(--halo-text-secondary)', 
							cursor: 'pointer',
							transition: 'all 0.2s ease',
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
					width: '100%', padding: '10px', marginTop: '12px',
					fontSize: '11px', fontWeight: 500, color: 'var(--halo-text-muted)', 
					background: 'transparent', border: '1px dashed var(--halo-border)', 
					borderRadius: '8px', cursor: 'pointer',
					display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
					transition: 'all 0.2s',
				}}
			>
				<span>{showAdvanced ? '▲' : '▼'}</span>
				{showAdvanced ? t('darkMode.hideAdvanced', { defaultValue: 'Hide Advanced' }) : t('darkMode.showAdvanced', { defaultValue: 'Show Advanced' })}
			</button>

			{/* Advanced Options */}
			{showAdvanced && (
				<div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--halo-border)' }}>
					<div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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

					<div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-secondary)', margin: '20px 0 10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
						{t('darkMode.fixes', { defaultValue: 'Fixes (Site-Specific)' })}
					</div>
					<textarea
						placeholder={t('darkMode.cssPlaceholder', { defaultValue: 'Custom CSS (e.g., body { color: white !important; })' })}
						value={mergedFixes.css}
						onChange={(e) => onFixesChange({ ...fixes, css: e.target.value })}
						style={{
							width: '100%', height: '80px', fontSize: '11px', fontFamily: 'monospace',
							background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', 
							border: '1px solid var(--halo-border)', borderRadius: '8px', 
							padding: '10px', resize: 'vertical', outline: 'none',
						}}
					/>
				</div>
			)}
		</Card>
	);
};
