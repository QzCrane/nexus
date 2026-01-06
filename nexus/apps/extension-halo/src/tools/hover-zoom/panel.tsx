// goal: Hover Zoom settings panel
// eff: Aligned with smooth-scroll panel style

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { HoverZoomSettings, DEFAULT_SETTINGS, STORAGE_KEY, ViewMode, PopupPosition, KeyCombo } from './types';
import { enableAntiHotlink, disableAntiHotlink, isAntiHotlinkEnabled } from './engine';
import { comboToString } from './content/resource-key-helper';
import { styles } from './panel.styles';

// Convert KeyCombo to display string
const keyComboDisplay = (combo: KeyCombo): string => {
    return comboToString(combo);
};

// Key combo editor component
const KeyComboEditor: React.FC<{
    value: KeyCombo;
    onChange: (combo: KeyCombo) => void;
    label: string;
}> = ({ value, onChange, label }) => {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', minWidth: '40px' }}>{label}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <input type="checkbox" checked={value.alt} onChange={(e) => onChange({ ...value, alt: e.target.checked })} />
                Alt
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <input type="checkbox" checked={value.ctrl} onChange={(e) => onChange({ ...value, ctrl: e.target.checked })} />
                Ctrl
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <input type="checkbox" checked={value.shift} onChange={(e) => onChange({ ...value, shift: e.target.checked })} />
                Shift
            </label>
            <span style={{ fontSize: '11px', color: 'var(--halo-text-secondary)', marginLeft: '8px' }}>
                = {keyComboDisplay(value)}
            </span>
        </div>
    );
};

export const HoverZoomPanel: React.FC = () => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<HoverZoomSettings>(DEFAULT_SETTINGS);
    const [antiHotlinkActive, setAntiHotlinkActive] = useState(false);

    useEffect(() => {
        (async () => {
            const res = await chrome.storage.local.get(STORAGE_KEY);
            if (res[STORAGE_KEY]) setSettings({ ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] });
            setAntiHotlinkActive(await isAntiHotlinkEnabled());
        })();
    }, []);

    const update = useCallback(async (patch: Partial<HoverZoomSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
        if (patch.antiHotlink !== undefined) {
            patch.antiHotlink ? await enableAntiHotlink() : await disableAntiHotlink();
            setAntiHotlinkActive(patch.antiHotlink);
        }
    }, [settings]);

    const updateResourceKeys = (key: 'imageKey' | 'videoKey', combo: KeyCombo) => {
        update({ resourceKeys: { ...settings.resourceKeys, [key]: combo } });
    };

    const updateExemptions = (p: Partial<HoverZoomSettings['exemptions']>) => update({ exemptions: { ...settings.exemptions, ...p } });

    return (
        <div style={styles.wrapper}>
            {/* Master Toggle */}
            <Card variant="default" padding="none">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: settings.enabled ? 'rgba(76,175,80,0.08)' : undefined, transition: 'background 0.3s' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--halo-text)' }}>🔍 {t('hoverZoom.enable')}</span>
                            {settings.enabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }} />}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', opacity: 0.8 }}>{t('hoverZoom.enableDesc')}</span>
                    </div>
                    <Toggle checked={settings.enabled} onChange={(v) => update({ enabled: v })} />
                </div>
            </Card>

            {/* Resource Keys - Seamless Image/Video Switching */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>🖼️ {t('hoverZoom.resourceKeys.title') || 'Resource Keys'}</span>
                    <p style={{ fontSize: '11px', color: 'var(--halo-text-secondary)', margin: '0 0 8px' }}>
                        {t('hoverZoom.resourceKeys.desc') || 'Configure hotkeys for image and video preview. More specific combos win.'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <KeyComboEditor
                            label={t('hoverZoom.resourceKeys.image') || 'Image'}
                            value={settings.resourceKeys.imageKey}
                            onChange={(combo) => updateResourceKeys('imageKey', combo)}
                        />
                        <KeyComboEditor
                            label={t('hoverZoom.resourceKeys.video') || 'Video'}
                            value={settings.resourceKeys.videoKey}
                            onChange={(combo) => updateResourceKeys('videoKey', combo)}
                        />
                    </div>
                </div>
            </Card>

            {/* Trigger Delay */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>⏱️ {t('hoverZoom.trigger.title')}</span>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.trigger.delay')}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input type="range" min="0" max="1000" step="50" value={settings.triggerDelay} onChange={(e) => update({ triggerDelay: +e.target.value })} style={{ width: '100px' }} />
                            <span style={styles.value}>{settings.triggerDelay}ms</span>
                        </div>
                    </div>
                </div>
            </Card>

            {/* View */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>🎨 {t('hoverZoom.view.title')}</span>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.view.mode')}</span>
                        <div style={styles.segmented}>
                            {(['auto', 'fit', 'panoramic'] as ViewMode[]).map(m => (
                                <button key={m} style={settings.viewMode === m ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ viewMode: m })}>
                                    {t(`hoverZoom.mode.${m}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.view.position')}</span>
                        <select value={settings.position} onChange={(e) => update({ position: e.target.value as PopupPosition })} style={styles.select}>
                            <option value="auto">Auto</option><option value="left">Left</option><option value="right">Right</option><option value="center">Center</option>
                        </select>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.view.loadingIndicator') || 'Loading indicator'}</span>
                        <Toggle checked={settings.showLoadingIndicator} onChange={(v) => update({ showLoadingIndicator: v })} />
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.view.antiHotlink')}{antiHotlinkActive && <span style={{ marginLeft: '6px', color: '#4CAF50' }}>●</span>}</span>
                        <Toggle checked={settings.antiHotlink} onChange={(v) => update({ antiHotlink: v })} />
                    </div>
                </div>
            </Card>

            {/* Exemptions */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>🚫 {t('hoverZoom.exemptions.title')}</span>
                    <div style={styles.row}><span style={styles.label}>{t('hoverZoom.exemptions.smallInteractive')}</span><Toggle checked={settings.exemptions.smallInteractive} onChange={(v) => updateExemptions({ smallInteractive: v })} /></div>
                    <div style={styles.row}><span style={styles.label}>{t('hoverZoom.exemptions.playingVideo')}</span><Toggle checked={settings.exemptions.playingVideo} onChange={(v) => updateExemptions({ playingVideo: v })} /></div>
                </div>
            </Card>

            {/* Hotkeys */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>⌨️ {t('hoverZoom.hotkeys.title')}</span>
                    <div style={styles.hotkeyList}>
                        {['download', 'copy', 'newtab', 'rotate', 'close'].map(k => (
                            <div key={k} style={styles.hotkeyItem}>
                                <span style={styles.hotkeyKey}>{k === 'download' ? 'S' : k === 'copy' ? 'C' : k === 'newtab' ? 'T' : k === 'rotate' ? 'R' : 'Esc'}</span>
                                <span>{t(`hoverZoom.hotkeys.${k}`).split(' - ')[1]}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </div>
    );
};
