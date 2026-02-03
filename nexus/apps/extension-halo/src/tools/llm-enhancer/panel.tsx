import React, { useState, useEffect, useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { styles } from './panel.styles';
// import { useTranslation } from '../../i18n';

// Core Halo prefs key
const TOOL_PREFS_KEY = 'halo_tool_prefs';
// Internal config key
const DATA_KEY = 'tool.llm-enhancer.config';

const DEFAULT_CONFIG = {
    // Note: 'enabled' is now primarily driven by halo_tool_prefs, but we keep it here for script compatibility or fallback
    widescreen: true,
    timeline: true,
    widthPercent: 100,
    keepAlive: true,
    timeline_chatgpt: true,
    timeline_deepseek: true,
    timeline_gemini: true,
};

export const LLMEnhancerPanel: React.FC = () => {
    // const { t } = useTranslation(); 
    const [enabled, setEnabled] = useState(true);
    const [config, setConfig] = useState(DEFAULT_CONFIG);

    useEffect(() => {
        // Load initial state
        chrome.storage.local.get([TOOL_PREFS_KEY, DATA_KEY], (res) => {
            // 1. Load Global Enabled State
            const prefs = res[TOOL_PREFS_KEY] || {};
            const toolPref = prefs['llm-enhancer'];
            // If toolPref is undefined, default to true (as per DEFAULT_TOOL_PREFS in registry)
            setEnabled(toolPref?.enabled ?? true);

            // 2. Load Internal Config
            if (res[DATA_KEY]) {
                setConfig({ ...DEFAULT_CONFIG, ...res[DATA_KEY] });
            }
        });

        // Listen for storage changes
        const listener = (changes: any, area: string) => {
            if (area === 'local') {
                if (changes[TOOL_PREFS_KEY]) {
                    const newPrefs = changes[TOOL_PREFS_KEY].newValue || {};
                    setEnabled(newPrefs['llm-enhancer']?.enabled ?? true);
                }
                if (changes[DATA_KEY]) {
                    setConfig({ ...DEFAULT_CONFIG, ...changes[DATA_KEY].newValue });
                }
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const toggleEnable = useCallback(async (val: boolean) => {
        setEnabled(val);
        const res = await chrome.storage.local.get(TOOL_PREFS_KEY);
        const prefs = res[TOOL_PREFS_KEY] || {};
        prefs['llm-enhancer'] = { ...prefs['llm-enhancer'], enabled: val, lastUsed: Date.now() };
        await chrome.storage.local.set({ [TOOL_PREFS_KEY]: prefs });
    }, []);

    const updateConfig = useCallback((patch: Partial<typeof DEFAULT_CONFIG>) => {
        const next = { ...config, ...patch };
        setConfig(next);
        chrome.storage.local.set({ [DATA_KEY]: next });
    }, [config]);

    return (
        <div style={styles.wrapper}>
            {/* Master Toggle */}
            <Card variant="default" padding="none">
                <div style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', 
                    background: enabled ? 'rgba(76,175,80,0.08)' : undefined, 
                    transition: 'background 0.3s' 
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={styles.headerTitle}>🧠 AI Assistant Enhancer</span>
                            {enabled && <span style={styles.activeDot} />}
                        </div>
                        <span style={styles.headerDesc}>
                            Core features for ChatGPT, Claude, Gemini & DeepSeek
                        </span>
                    </div>
                    <Toggle checked={enabled} onChange={toggleEnable} />
                </div>
            </Card>

            {/* Appearance Section */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>🖥️ Appearance</span>
                    
                    <div style={styles.row}>
                        <div>
                            <div style={styles.label}>Widescreen Mode</div>
                            <div style={styles.desc}>Expand chat width for better readability</div>
                        </div>
                        <Toggle checked={config.widescreen} onChange={v => updateConfig({ widescreen: v })} />
                    </div>
                    
                    {config.widescreen && (
                        <div style={{ padding: '4px 0 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={styles.label}>Max Width</span>
                                <span style={styles.value}>{config.widthPercent}%</span>
                            </div>
                            <input 
                                type="range"
                                min="50" max="150" step="1" 
                                value={config.widthPercent} 
                                onChange={(e) => updateConfig({ widthPercent: parseInt(e.target.value) })}
                                onWheel={(e) => {
                                    e.preventDefault();
                                    const delta = e.deltaY > 0 ? -2 : 2;
                                    const next = Math.min(150, Math.max(50, config.widthPercent + delta));
                                    if (next !== config.widthPercent) updateConfig({ widthPercent: next });
                                }}
                                style={styles.input ? { ...styles.input, padding: 0 } : { width: '100%', cursor: 'pointer' }}
                            />
                        </div>
                    )}

                    <div style={{ ...styles.row, borderTop: '1px solid var(--halo-border)', paddingTop: '12px' }}>
                        <div>
                            <div style={styles.label}>Timeline Navigation</div>
                            <div style={styles.desc}>Quick jump to conversation turns</div>
                        </div>
                        <Toggle checked={config.timeline} onChange={v => updateConfig({ timeline: v })} />
                    </div>

                    {config.timeline && (
                        <div style={{ paddingLeft: '12px', marginTop: '8px', borderLeft: '2px solid var(--halo-border)', opacity: 0.9 }}>
                             <div style={{ ...styles.row, padding: '4px 0' }}>
                                <div style={{ fontSize: '13px', color: 'var(--halo-text-secondary)' }}>ChatGPT</div>
                                <Toggle checked={config.timeline_chatgpt ?? true} onChange={v => updateConfig({ timeline_chatgpt: v })} />
                             </div>
                             <div style={{ ...styles.row, padding: '4px 0' }}>
                                <div style={{ fontSize: '13px', color: 'var(--halo-text-secondary)' }}>DeepSeek</div>
                                <Toggle checked={config.timeline_deepseek ?? true} onChange={v => updateConfig({ timeline_deepseek: v })} />
                             </div>
                             <div style={{ ...styles.row, padding: '4px 0' }}>
                                <div style={{ fontSize: '13px', color: 'var(--halo-text-secondary)' }}>Gemini</div>
                                <Toggle checked={config.timeline_gemini ?? true} onChange={v => updateConfig({ timeline_gemini: v })} />
                             </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Utilities Section */}
            <Card variant="default" padding="sm">
                <div style={styles.section}>
                    <span style={styles.sectionTitle}>⚡ Utilities</span>
                    <div style={styles.row}>
                        <div>
                            <div style={styles.label}>Keep Alive</div>
                            <div style={styles.desc}>Prevent session timeout auto-refresh</div>
                        </div>
                        <Toggle checked={config.keepAlive} onChange={v => updateConfig({ keepAlive: v })} />
                    </div>
                </div>
            </Card>
        </div>
    );
};
