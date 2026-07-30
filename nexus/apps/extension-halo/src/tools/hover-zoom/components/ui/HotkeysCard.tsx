// Hotkeys card component for Hover Zoom panel
import type React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../../../i18n';
import type { HoverZoomSettings } from '../../types';
import { styles } from './panel.styles';

interface HotkeysCardProps {
	settings: HoverZoomSettings;
	onUpdate: (patch: Partial<HoverZoomSettings>) => void;
}

const HOTKEY_MAP: Record<string, string> = {
	download: 'S', copy: 'C', newtab: 'T', rotate: 'R', close: 'Esc', pin: '␣'
};

export const HotkeysCard: React.FC<HotkeysCardProps> = ({ settings, onUpdate }) => {
	const { t } = useTranslation();

	return (
		<Card variant="default" padding="sm">
			<div style={styles.section}>
				<span style={styles.sectionTitle}>⌨️ {t('hoverZoom.hotkeys.title')}</span>
				{/* Pin Mode Setting */}
				<div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--halo-border)' }}>
					<div style={styles.row}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
							<span style={styles.label}>📌 {t('hoverZoom.pinMode.key') || 'Pin Key'}</span>
							<span style={{ fontSize: '10px', color: 'var(--halo-text-secondary)' }}>
								{t('hoverZoom.pinMode.keyDesc') || 'Press to pin viewer (drag/resize)'}
							</span>
						</div>
						<div style={styles.segmented}>
							<button type="button"
								style={settings.pinKey === ' ' ? styles.segmentBtnActive : styles.segmentBtn}
								onClick={() => onUpdate({ pinKey: ' ' })}
							>
								{t('hoverZoom.pinMode.space') || 'Space'}
							</button>
							<button type="button"
								style={settings.pinKey === '' ? styles.segmentBtnActive : styles.segmentBtn}
								onClick={() => onUpdate({ pinKey: '' })}
							>
								{t('hoverZoom.pinMode.none') || 'Disabled'}
							</button>
						</div>
					</div>
				</div>
				<div style={styles.hotkeyList}>
					{Object.keys(HOTKEY_MAP).map(k => (
						<div key={k} style={styles.hotkeyItem}>
							<span style={styles.hotkeyKey}>{HOTKEY_MAP[k]}</span>
							<span>{t(`hoverZoom.hotkeys.${k}`).split(' - ')[1] || t(`hoverZoom.hotkeys.${k}`)}</span>
						</div>
					))}
				</div>
			</div>
		</Card>
	);
};
