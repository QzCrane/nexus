import type React from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import type { HoverZoomSettings } from '../../types';
import { styles } from './panel.styles';

interface InfoBarSettingsProps {
    settings: HoverZoomSettings;
    update: (patch: Partial<HoverZoomSettings>) => void;
    t: (key: string) => string;
}

export const InfoBarSettings: React.FC<InfoBarSettingsProps> = ({ settings, update, t }) => {
    return (
        <Card variant="default" padding="sm">
            <div style={styles.section}>
                <span style={styles.sectionTitle}>ℹ️ {t('hoverZoom.infoBar.title') || 'Info Bar'}</span>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.typeIcon') || 'Type icon'}</span><Toggle checked={settings.imageInfoItems.typeIcon} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, typeIcon: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.dimensions') || 'Dimensions'}</span><Toggle checked={settings.imageInfoItems.dimensions} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, dimensions: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.ratio') || 'Ratio'}</span><Toggle checked={settings.imageInfoItems.ratio} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, ratio: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.scale') || 'Scale'}</span><Toggle checked={settings.imageInfoItems.scale} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, scale: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.format') || 'Format'}</span><Toggle checked={settings.imageInfoItems.format} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, format: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.size') || 'File size'}</span><Toggle checked={settings.imageInfoItems.size} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, size: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.caption') || 'Caption'}</span><Toggle checked={settings.imageInfoItems.caption} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, caption: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.source') || 'Rule source'}</span><Toggle checked={settings.imageInfoItems.source} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, source: v } })} /></div>
                <div style={styles.row}><span style={styles.label}>{t('hoverZoom.infoBar.hostname') || 'Image host'}</span><Toggle checked={settings.imageInfoItems.hostname} onChange={(v) => update({ imageInfoItems: { ...settings.imageInfoItems, hostname: v } })} /></div>
            </div>
        </Card>
    );
};
