
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
// import { useTranslation } from '../../i18n';

// Core Halo prefs key
const TOOL_PREFS_KEY = 'halo_tool_prefs';
// Internal config key
const DATA_KEY = 'tool.llm-enhancer.config';

const DEFAULT_CONFIG = {
    // Note: 'enabled' is now primarily driven by halo_tool_prefs, but we keep it here for script compatibility or fallback
    widescreen: true,
    timeline: true,
    widthPercent: 90,
    keepAlive: true,
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

    // Toggle Main Enable (Sync to halo_tool_prefs)
    const toggleEnable = useCallback(async (val: boolean) => {
        setEnabled(val);
        const res = await chrome.storage.local.get(TOOL_PREFS_KEY);
        const prefs = res[TOOL_PREFS_KEY] || {};
        prefs['llm-enhancer'] = { ...prefs['llm-enhancer'], enabled: val, lastUsed: Date.now() };
        await chrome.storage.local.set({ [TOOL_PREFS_KEY]: prefs });
        
        // Also sync to internal config for script.js compatibility if needed, 
        // though script.js should ideally read halo_tool_prefs too.
        // We'll leave script.js reading its own enabled key as a fallback, but the master switch is now halo_tool_prefs.
    }, []);

    // Update Internal Config
    const updateConfig = useCallback((patch: Partial<typeof DEFAULT_CONFIG>) => {
        const next = { ...config, ...patch };
        setConfig(next);
        chrome.storage.local.set({ [DATA_KEY]: next });
    }, [config]);

    const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' };
    const labelStyle = { fontSize: '14px', fontWeight: 500, color: 'var(--halo-text)' };
    const descStyle = { fontSize: '12px', color: 'var(--halo-text-secondary)', marginTop: '4px' };
    const headerStyle = { fontSize: '15px', fontWeight: 600, color: 'var(--halo-text)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
            
            {/* Master Toggle (Green Active Style) */}
            <Card variant="default" padding="none">
                <div style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', 
                    background: enabled ? 'rgba(76,175,80,0.08)' : undefined, 
                    transition: 'background 0.3s' 
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={headerStyle}>🧠 AI Assistant Enhancer</span>
                            {enabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }} />}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', opacity: 0.8 }}>
                            Core features for ChatGPT, Claude, Gemini & DeepSeek
                        </span>
                    </div>
                    <Toggle checked={enabled} onChange={toggleEnable} />
                </div>
            </Card>

            <Card variant="default" padding="sm">
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--halo-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Appearance
                </div>
                
                <div style={rowStyle}>
                    <div>
                        <div style={labelStyle}>Widescreen Mode</div>
                        <div style={descStyle}>Expand chat width for better readability</div>
                    </div>
                    <Toggle checked={config.widescreen} onChange={v => updateConfig({ widescreen: v })} />
                </div>
                
                {config.widescreen && (
                    <div style={{ padding: '8px 0 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                            <span>Max Width</span>
                            <span>{config.widthPercent}%</span>
                        </div>
                        <input 
                            type="range"
                            min="50" max="100" step="1" 
                            value={config.widthPercent} 
                            onChange={(e) => updateConfig({ widthPercent: parseInt(e.target.value) })}
                            style={{ width: '100%', cursor: 'pointer' }}
                        />
                    </div>
                )}

                <div style={{ ...rowStyle, borderTop: '1px solid var(--halo-border)' }}>
                    <div>
                        <div style={labelStyle}>Timeline Navigation</div>
                        <div style={descStyle}>Quick jump to conversation turns</div>
                    </div>
                    <Toggle checked={config.timeline} onChange={v => updateConfig({ timeline: v })} />
                </div>
            </Card>

            <Card variant="default" padding="sm">
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--halo-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Utilities
                </div>
                
                <div style={rowStyle}>
                    <div>
                        <div style={labelStyle}>Keep Alive</div>
                        <div style={descStyle}>Prevent session timeout auto-refresh</div>
                    </div>
                    <Toggle checked={config.keepAlive} onChange={v => updateConfig({ keepAlive: v })} />
                </div>
            </Card>
        </div>
    );
};
