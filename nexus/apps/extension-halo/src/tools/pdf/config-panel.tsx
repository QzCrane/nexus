// goal: PDF operation config panel
// eff: Dynamic config UI based on selected operation

import React from 'react';
import { Card } from '@nexus/ui-kit';
import type { PDFOperation } from './types';

export interface OperationConfig {
	splitRanges: string;
	extractPages: string;
	rotateDegrees: 90 | 180 | 270;
	watermarkText: string;
	watermarkOpacity: number;
	pageSize: 'A4' | 'Letter' | 'fit';
}

export const DEFAULT_CONFIG: OperationConfig = {
	splitRanges: '',
	extractPages: '',
	rotateDegrees: 90,
	watermarkText: 'CONFIDENTIAL',
	watermarkOpacity: 0.3,
	pageSize: 'A4',
};

interface ConfigPanelProps {
	operation: PDFOperation | null;
	config: OperationConfig;
	setConfig: React.Dispatch<React.SetStateAction<OperationConfig>>;
	t: (key: string) => string;
}

const inputStyle: React.CSSProperties = {
	width: '100%', padding: '8px 10px', borderRadius: '6px',
	border: '1px solid var(--halo-border)', background: 'var(--halo-bg)',
	color: 'var(--halo-text)', fontSize: '12px',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
const labelStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '4px', display: 'block' };

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ operation, config, setConfig, t }) => {
	if (!operation || operation === 'merge') return null;

	return (
		<Card variant="default" padding="sm">
			<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
				<div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' }}>
					{t('pdfPanel.config')}
				</div>

				{operation === 'split' && (
					<div>
						<label style={labelStyle}>{t('pdfPanel.splitRanges')}</label>
						<input style={inputStyle} value={config.splitRanges} onChange={(e) => setConfig((c) => ({ ...c, splitRanges: e.target.value }))} placeholder="1-3, 5-7" />
					</div>
				)}

				{operation === 'extract' && (
					<div>
						<label style={labelStyle}>{t('pdfPanel.extractPages')}</label>
						<input style={inputStyle} value={config.extractPages} onChange={(e) => setConfig((c) => ({ ...c, extractPages: e.target.value }))} placeholder="1, 3, 5-10" />
					</div>
				)}

				{operation === 'rotate' && (
					<div>
						<label style={labelStyle}>{t('pdfPanel.rotateAngle')}</label>
						<select style={selectStyle} value={config.rotateDegrees} onChange={(e) => setConfig((c) => ({ ...c, rotateDegrees: Number(e.target.value) as 90 | 180 | 270 }))}>
							<option value={90}>90°</option>
							<option value={180}>180°</option>
							<option value={270}>270°</option>
						</select>
					</div>
				)}

				{operation === 'watermark' && (
					<>
						<div>
							<label style={labelStyle}>{t('pdfPanel.watermarkText')}</label>
							<input style={inputStyle} value={config.watermarkText} onChange={(e) => setConfig((c) => ({ ...c, watermarkText: e.target.value }))} />
						</div>
						<div>
							<label style={labelStyle}>{t('pdfPanel.watermarkOpacity')} ({Math.round(config.watermarkOpacity * 100)}%)</label>
							<input type="range" min="0.1" max="1" step="0.1" value={config.watermarkOpacity} onChange={(e) => setConfig((c) => ({ ...c, watermarkOpacity: Number(e.target.value) }))} style={{ width: '100%' }} />
						</div>
					</>
				)}

				{operation === 'images-to-pdf' && (
					<div>
						<label style={labelStyle}>{t('pdfPanel.pageSize')}</label>
						<select style={selectStyle} value={config.pageSize} onChange={(e) => setConfig((c) => ({ ...c, pageSize: e.target.value as 'A4' | 'Letter' | 'fit' }))}>
							<option value="A4">{t('pdfPanel.A4')}</option>
							<option value="Letter">{t('pdfPanel.Letter')}</option>
							<option value="fit">{t('pdfPanel.fitImage')}</option>
						</select>
					</div>
				)}
			</div>
		</Card>
	);
};
