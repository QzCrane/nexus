// goal: PDF operation config panel
// eff: Dynamic config UI based on selected operation

import type React from 'react';
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
						<label htmlFor="pdf-split-ranges" style={labelStyle}>{t('pdfPanel.splitRanges')}</label>
						<input id="pdf-split-ranges" style={inputStyle} value={config.splitRanges} onChange={(e) => setConfig((c) => ({ ...c, splitRanges: e.target.value }))} placeholder={t('pdfPanel.placeholders.splitRange')} />
					</div>
				)}

				{operation === 'extract' && (
					<div>
						<label htmlFor="pdf-extract-pages" style={labelStyle}>{t('pdfPanel.extractPages')}</label>
						<input id="pdf-extract-pages" style={inputStyle} value={config.extractPages} onChange={(e) => setConfig((c) => ({ ...c, extractPages: e.target.value }))} placeholder={t('pdfPanel.placeholders.extractPages')} />
					</div>
				)}

			{operation === 'rotate' && (
					<div>
						<div style={labelStyle}>{t('pdfPanel.rotateAngle')}</div>
						<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
							{[90, 180, 270].map((deg) => (
								<button
									key={deg}
									type="button"
									style={{
										border: 'none',
										background: config.rotateDegrees === deg ? 'var(--halo-accent)' : 'transparent',
										color: config.rotateDegrees === deg ? '#fff' : 'var(--halo-text-muted)',
										padding: '6px 12px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
									}}
									onClick={() => setConfig((c) => ({ ...c, rotateDegrees: deg as 90 | 180 | 270 }))}
								>
									{deg}°
								</button>
							))}
						</div>
					</div>
				)}

				{operation === 'watermark' && (
					<>
						<div>
							<label htmlFor="pdf-watermark-text" style={labelStyle}>{t('pdfPanel.watermarkText')}</label>
							<input id="pdf-watermark-text" style={inputStyle} value={config.watermarkText} onChange={(e) => setConfig((c) => ({ ...c, watermarkText: e.target.value }))} />
						</div>
						<div>
							<label htmlFor="pdf-watermark-opacity" style={labelStyle}>{t('pdfPanel.watermarkOpacity')} ({Math.round(config.watermarkOpacity * 100)}%)</label>
							<input id="pdf-watermark-opacity" type="range" min="0.1" max="1" step="0.1" value={config.watermarkOpacity} onChange={(e) => setConfig((c) => ({ ...c, watermarkOpacity: Number(e.target.value) }))} style={{ width: '100%' }} />
						</div>
					</>
				)}

				{operation === 'images-to-pdf' && (
					<div>
						<div style={labelStyle}>{t('pdfPanel.pageSize')}</div>
						<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
							{(['A4', 'Letter', 'fit'] as const).map((size) => (
								<button
									key={size}
									type="button"
									style={{
										border: 'none',
										background: config.pageSize === size ? 'var(--halo-accent)' : 'transparent',
										color: config.pageSize === size ? '#fff' : 'var(--halo-text-muted)',
										padding: '6px 12px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
									}}
									onClick={() => setConfig((c) => ({ ...c, pageSize: size }))}
								>
									{size === 'fit' ? t('pdfPanel.fitImage') : t(`pdfPanel.${size}`)}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</Card>
	);
};
