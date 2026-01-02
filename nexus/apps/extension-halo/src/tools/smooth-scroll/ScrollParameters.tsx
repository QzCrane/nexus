// goal: Scroll Parameters sub-component
// eff: Extracted to separate file

import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ScrollSettings } from './types';
import { EASING_OPTIONS } from './types';
import { styles } from './panel.styles';

interface ScrollParametersProps {
	settings: ScrollSettings;
	updateSetting: <K extends keyof ScrollSettings>(key: K, value: ScrollSettings[K]) => void;
}

export const ScrollParameters: React.FC<ScrollParametersProps> = ({ settings, updateSetting }) => {
	const { t } = useTranslation();

	return (
		<Card variant="default" padding="md">
			<div style={styles.section}>
				<span style={styles.sectionTitle}>⚡ {t('smoothScroll.behavior')}</span>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.stepSize')}</div><div style={styles.sublabel}>{t('smoothScroll.units.px')}</div></div>
					<input type="number" value={settings.stepSize} onChange={(e) => updateSetting('stepSize', parseInt(e.target.value) || 100)} style={styles.input} disabled={!settings.enabled} min={10} max={500} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.animationTime')}</div><div style={styles.sublabel}>{t('smoothScroll.units.ms')}</div></div>
					<input type="number" value={settings.animationTime} onChange={(e) => updateSetting('animationTime', parseInt(e.target.value) || 400)} style={styles.input} disabled={!settings.enabled} min={50} max={2000} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.accelerationMax')}</div><div style={styles.sublabel}>{t('smoothScroll.units.x')}</div></div>
					<input type="number" value={settings.accelerationMax} onChange={(e) => updateSetting('accelerationMax', parseFloat(e.target.value) || 3)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.accelerationDelta')}</div><div style={styles.sublabel}>{t('smoothScroll.units.ms')}</div></div>
					<input type="number" value={settings.accelerationDelta} onChange={(e) => updateSetting('accelerationDelta', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={300} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.pulseScale')}</div><div style={styles.sublabel}>{t('smoothScroll.units.x')}</div></div>
					<input type="number" value={settings.pulseScale} onChange={(e) => updateSetting('pulseScale', parseFloat(e.target.value) || 4)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.arrowKeyStep')}</div><div style={styles.sublabel}>{t('smoothScroll.units.px')}</div></div>
					<input type="number" value={settings.arrowKeyStep} onChange={(e) => updateSetting('arrowKeyStep', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={200} />
				</div>

				<div style={styles.row}>
					<div style={styles.label}>{t('smoothScroll.easing')}</div>
					<div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
						{EASING_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								type="button"
								disabled={!settings.enabled}
								style={{
									border: 'none',
									background: settings.easing === opt.value ? 'var(--halo-accent)' : 'transparent',
									color: settings.easing === opt.value ? '#fff' : 'var(--halo-text-muted)',
									padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: settings.enabled ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
									opacity: settings.enabled ? 1 : 0.5,
								}}
								onClick={() => settings.enabled && updateSetting('easing', opt.value)}
							>
								{t(`smoothScroll.easingOptions.${opt.value}` as any)}
							</button>
						))}
					</div>
				</div>
			</div>
		</Card>
	);
};
