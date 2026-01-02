// goal: XOR panel UI

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { xor, toHex, fromHex } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const XorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('xor-input' as any, '');
    const [key, setKey] = useToolState<string>('xor-key' as any, '');
    const [isHexInput, setIsHexInput] = useToolState<boolean>('xor-is-hex-input' as any, false);
    const [isHexOutput, setIsHexOutput] = useToolState<boolean>('xor-is-hex-output' as any, false);


    const result = useMemo(() => {
        if (!input || !key) return '';
        try {
            const data = isHexInput ? fromHex(input) : input;
            const processed = xor(data, key);
            return isHexOutput ? toHex(processed) : processed;
        } catch {
            return 'Error';
        }
    }, [input, key, isHexInput, isHexOutput]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<div style={styles.label}>Input</div>
				<textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder="Data to XOR..." 
                />
                <label style={styles.checkbox}>
                    <input type="checkbox" checked={isHexInput} onChange={(e) => setIsHexInput(e.target.checked)} />
                    Input is Hex
                </label>
			</div>

            <div style={styles.row}>
                <div style={styles.label}>Key</div>
                <input 
                    style={styles.input} 
                    value={key} 
                    onChange={(e) => setKey(e.target.value)} 
                    placeholder="Secret Key" 
                />
            </div>

			<div style={styles.row}>
				<div style={styles.label}>Result</div>
				<textarea style={styles.textarea} value={result} readOnly />
                <label style={styles.checkbox}>
                    <input type="checkbox" checked={isHexOutput} onChange={(e) => setIsHexOutput(e.target.checked)} />
                    Output as Hex
                </label>
			</div>
		</div>
	);
};
