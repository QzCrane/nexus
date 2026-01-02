// goal: ROT13 panel UI

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { rot13, rot47, rotN } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


type Mode = 'ROT13' | 'ROT47' | 'Custom';

export const Rot13Panel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('rot13-input' as any, '');
    const [mode, setMode] = useToolState<Mode>('rot13-mode' as any, 'ROT13');
    const [shift, setShift] = useToolState<number>('rot13-shift' as any, 13);


    const output = useMemo(() => {
        if (!input) return '';
        switch (mode) {
            case 'ROT13': return rot13(input);
            case 'ROT47': return rot47(input);
            case 'Custom': return rotN(input, shift);
            default: return '';
        }
    }, [input, mode, shift]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
            <div style={styles.toolbar}>
                {(['ROT13', 'ROT47', 'Custom'] as Mode[]).map(m => (
                    <button 
                        key={m} 
                        style={mode === m ? styles.activeBtn : styles.btn} 
                        onClick={() => setMode(m)}
                    >
                        {m}
                    </button>
                ))}
            </div>

            {mode === 'Custom' && (
                <div style={styles.sliderContainer}>
                    <span style={styles.label}>Shift: {shift}</span>
                    <input 
                        type="range" 
                        min="1" max="25" 
                        value={shift} 
                        onChange={(e) => setShift(parseInt(e.target.value))} 
                        style={styles.slider} 
                    />
                </div>
            )}

			<div>
				<div style={styles.label}>Input</div>
				<textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder="Hello World" 
                />
			</div>

            <div style={{textAlign: 'center', fontSize: '20px', color: 'var(--halo-text-muted)'}}>⬇️</div>

			<div>
				<div style={styles.label}>Output</div>
				<textarea style={styles.textarea} value={output} readOnly />
			</div>

            <button style={styles.btn} onClick={handleCopy}>📋 Copy Result</button>
		</div>
	);
};
