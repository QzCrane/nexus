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
					<div><div style={styles.label}>{t('smoothScroll.stepSize')}</div><div style={styles.sublabel}>px</div></div>
					<input type="number" value={settings.stepSize} onChange={(e) => updateSetting('stepSize', parseInt(e.target.value) || 100)} style={styles.input} disabled={!settings.enabled} min={10} max={500} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.animationTime')}</div><div style={styles.sublabel}>ms</div></div>
					<input type="number" value={settings.animationTime} onChange={(e) => updateSetting('animationTime', parseInt(e.target.value) || 400)} style={styles.input} disabled={!settings.enabled} min={50} max={2000} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.accelerationMax')}</div><div style={styles.sublabel}>x</div></div>
					<input type="number" value={settings.accelerationMax} onChange={(e) => updateSetting('accelerationMax', parseFloat(e.target.value) || 3)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.accelerationDelta')}</div><div style={styles.sublabel}>ms</div></div>
					<input type="number" value={settings.accelerationDelta} onChange={(e) => updateSetting('accelerationDelta', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={300} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.pulseScale')}</div><div style={styles.sublabel}>x</div></div>
					<input type="number" value={settings.pulseScale} onChange={(e) => updateSetting('pulseScale', parseFloat(e.target.value) || 4)} style={styles.input} disabled={!settings.enabled} min={1} max={10} step={0.5} />
				</div>

				<div style={styles.row}>
					<div><div style={styles.label}>{t('smoothScroll.arrowKeyStep')}</div><div style={styles.sublabel}>px</div></div>
					<input type="number" value={settings.arrowKeyStep} onChange={(e) => updateSetting('arrowKeyStep', parseInt(e.target.value) || 50)} style={styles.input} disabled={!settings.enabled} min={10} max={200} />
				</div>

				<div style={styles.row}>
					<div style={styles.label}>{t('smoothScroll.easing')}</div>
					<select value={settings.easing} onChange={(e) => updateSetting('easing', e.target.value as ScrollSettings['easing'])} style={styles.select} disabled={!settings.enabled}>
						{EASING_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{t(`smoothScroll.easingOptions.${opt.value}` as any)}</option>)}
					</select>
				</div>
			</div>
		</Card>
	);
};
