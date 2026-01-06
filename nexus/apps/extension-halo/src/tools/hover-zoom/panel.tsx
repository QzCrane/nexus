// goal: Hover Zoom settings panel
// eff: Aligned with smooth-scroll panel style

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { HoverZoomSettings, DEFAULT_SETTINGS, STORAGE_KEY, TriggerKey, ViewMode, PopupPosition } from './types';
import { enableAntiHotlink, disableAntiHotlink, isAntiHotlinkEnabled } from './engine';
import { styles } from './panel.styles';

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

            {/* Trigger */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>⌨️ {t('hoverZoom.trigger.title')}</span>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('hoverZoom.trigger.key')}</span>
                        <div style={styles.segmented}>
                            {(['none', 'shift', 'ctrl', 'alt'] as TriggerKey[]).map(k => (
                                <button key={k} style={settings.triggerKey === k ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ triggerKey: k })}>
                                    {k === 'none' ? '无' : k.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                    {settings.triggerKey !== 'none' && (
                        <div style={styles.row}>
                            <span style={styles.label}>{t('hoverZoom.trigger.action')}</span>
                            <div style={styles.segmented}>
                                <button style={settings.triggerAction === 'hold' ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ triggerAction: 'hold' })}>
                                    {t('hoverZoom.trigger.hold')}
                                </button>
                                <button style={settings.triggerAction === 'toggle' ? styles.segmentBtnActive : styles.segmentBtn} onClick={() => update({ triggerAction: 'toggle' })}>
                                    {t('hoverZoom.trigger.toggle')}
                                </button>
                            </div>
                        </div>
                    )}
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
