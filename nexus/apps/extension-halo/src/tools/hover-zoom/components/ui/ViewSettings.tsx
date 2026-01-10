import React from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { HoverZoomSettings, HighlightMode, ViewMode } from '../../types';
import { styles } from './panel.styles';

interface ViewSettingsProps {
    settings: HoverZoomSettings;
    update: (patch: Partial<HoverZoomSettings>) => void;
    t: (key: string) => string;
    antiHotlinkActive: boolean;
}

export const ViewSettings: React.FC<ViewSettingsProps> = ({ settings, update, t, antiHotlinkActive }) => {
    return (
        <Card variant="default" padding="sm">
            <div style={styles.section}>
                <span style={styles.sectionTitle}>🎨 {t('hoverZoom.view.title')}</span>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.highlight') || 'Trigger highlight'}</span>
                    <div style={styles.segmented}>
                        {(['always', 'hotkey', 'off'] as HighlightMode[]).map(m => (
                            <button key={m} style={settings.highlightMode === m ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ highlightMode: m })}>
                                {m === 'always' ? (t('hoverZoom.highlight.always') || 'Always') : m === 'hotkey' ? (t('hoverZoom.highlight.hotkey') || 'Hotkey') : (t('hoverZoom.highlight.off') || 'Off')}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.viewMode') || 'Size mode'}</span>
                    <div style={styles.segmented}>
                        {(['original', 'fit'] as ViewMode[]).map(m => (
                            <button key={m} style={settings.viewMode === m ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ viewMode: m })}>
                                {m === 'original' ? (t('hoverZoom.viewMode.original') || 'Original') : (t('hoverZoom.viewMode.fit') || 'Fit')}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.borderRadius') || 'Border radius'}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="range" min="0" max="32" step="2" value={settings.borderRadius} onChange={(e) => update({ borderRadius: +e.target.value })} style={{ width: '80px' }} />
                        <span style={styles.value}>{settings.borderRadius}px</span>
                    </div>
                </div>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.loadingIndicator') || 'Loading indicator'}</span>
                    <Toggle checked={settings.showLoadingIndicator} onChange={(v) => update({ showLoadingIndicator: v })} />
                </div>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.antiHotlink')}{antiHotlinkActive && <span style={{ marginLeft: '6px', color: '#4CAF50' }}>●</span>}</span>
                    <Toggle checked={settings.antiHotlink} onChange={(v) => update({ antiHotlink: v })} />
                </div>
                <div style={styles.row}>
                    <span style={styles.label}>{t('hoverZoom.view.videoFallback') || 'Video → Image fallback'}</span>
                    <Toggle checked={settings.videoFallbackToImage} onChange={(v) => update({ videoFallbackToImage: v })} />
                </div>
            </div>
        </Card>
    );
};
