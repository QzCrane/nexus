import React from 'react';
import { styles } from '../styles';

export const MasterToggle: React.FC<{ 
    enabled: boolean; 
    onToggle: () => void; 
    title: string; 
    subtitle: string; 
    onSettings: () => void;
    settingsTitle: string;
}> = ({ enabled, onToggle, title, subtitle, onSettings, settingsTitle }) => (
    <div style={{ ...styles.masterCard, ...(enabled ? styles.masterCardActive : {}), flexDirection: 'row', justifyContent: 'space-between', paddingRight: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div onClick={onToggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ ...styles.toggle, ...(enabled ? styles.toggleActive : {}) }}>
                    <div style={{ ...styles.toggleKnob, left: enabled ? '18px' : '2px' }} />
                </div>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 600 }}>⚡ {title}</span>
                        {enabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }} />}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', marginTop: '2px' }}>{subtitle}</div>
                </div>
            </div>
        </div>
        <button 
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '4px', opacity: 0.7 }}
            onClick={onSettings}
            title={settingsTitle}
        >⚙️</button>
    </div>
);

export const PermissionWarning: React.FC<{ onEnable: () => void; text: string; btnText: string }> = ({ onEnable, text, btnText }) => (
    <div style={{
        margin: '10px 15px', padding: '10px', background: 'var(--halo-warning-muted)',
        border: '1px solid var(--halo-warning)', borderRadius: '6px', fontSize: '13px',
        display: 'flex', flexDirection: 'column', gap: '8px'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>⚠️</span>
            <span>{text}</span>
        </div>
        <button style={{ ...styles.btn, fontSize: '12px', padding: '6px' }} onClick={onEnable}>{btnText}</button>
    </div>
);
