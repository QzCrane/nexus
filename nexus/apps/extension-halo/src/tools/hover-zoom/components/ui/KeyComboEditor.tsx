// goal: Key combo editor component for Hover Zoom settings
// eff: Reusable checkbox combo for modifier keys

import React from 'react';
import type { KeyCombo } from '../../types';
import { comboToString } from '../../content/utils/resource-key-helper';

interface Props {
    value: KeyCombo;
    onChange: (combo: KeyCombo) => void;
    label: string;
}

export const KeyComboEditor: React.FC<Props> = ({ value, onChange, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', minWidth: '40px' }}>{label}</span>
        
        {/* Disable Checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: value.disabled ? '#ff5252' : undefined }}>
            <input 
                type="checkbox" 
                checked={!!value.disabled} 
                onChange={(e) => onChange({ ...value, disabled: e.target.checked })} 
            />
            Disable
        </label>

        {!value.disabled && (
            <>
                <div style={{ width: '1px', height: '14px', background: 'var(--halo-border)', margin: '0 4px' }} />
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
                    = {comboToString(value)}
                </span>
            </>
        )}
    </div>
);
