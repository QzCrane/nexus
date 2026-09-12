// goal: ROT13 panel UI

import type React from 'react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { rot13, rot47, rotN } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


type Mode = 'ROT13' | 'ROT47' | 'Custom';
const rotModeCodec: ToolStateCodec<Mode> = {
	decode(value) { return value === 'ROT13' || value === 'ROT47' || value === 'Custom' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Rotation mode is unsupported.' }; },
	encode(value) { return value; },
};
const shiftCodec: ToolStateCodec<number> = {
	decode(value) { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 25 ? { kind: 'valid', value: value as number } : { kind: 'invalid', reason: 'Rotation shift must be an integer from 1 to 25.' }; },
	encode(value) { return value; },
};

export const Rot13Panel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('rot13-input', '');
    const [mode, setMode, , modeRecovery] = useToolState<Mode>('rot13-mode', 'ROT13', { codec: rotModeCodec });
    const [shift, setShift, , shiftRecovery] = useToolState<number>('rot13-shift', 13, { codec: shiftCodec });


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
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="ROT13" exportName="halo-rot-mode-damaged.json" />
			<StorageRecoveryActions recovery={shiftRecovery} emptyValue={13} exportName="halo-rot-shift-damaged.json" />
            <div style={styles.toolbar}>
                {(['ROT13', 'ROT47', 'Custom'] as Mode[]).map(m => (
                    <button type="button"
                        key={m} 
                        style={mode === m ? styles.activeBtn : styles.btn} 
                        onClick={() => setMode(m)}
                    >
                        {m === 'Custom' ? t('rot13.custom', { defaultValue: 'Custom' }) : m}
                    </button>
                ))}
            </div>

            {mode === 'Custom' && (
                <div style={styles.sliderContainer}>
                    <span style={styles.label}>{t('rot13.shift', { defaultValue: 'Shift' })}: {shift}</span>
                    <input 
                        type="range" 
                        min="1" max="25" 
                        value={shift} 
                        onChange={(e) => setShift(parseInt(e.target.value, 10))}
                        style={styles.slider} 
                    />
                </div>
            )}

			<div>
				<div style={styles.label}>{t('rot13.input', { defaultValue: 'Input' })}</div>
				<textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder={t('rot13.inputPlaceholder', { defaultValue: 'Hello World' })} 
                />
			</div>

            <div style={{textAlign: 'center', fontSize: '20px', color: 'var(--halo-text-muted)'}}>⬇️</div>

			<div>
				<div style={styles.label}>{t('rot13.output', { defaultValue: 'Output' })}</div>
				<textarea style={styles.textarea} value={output} readOnly />
			</div>

            <button type="button" style={styles.btn} onClick={handleCopy}>📋 {t('rot13.copy', { defaultValue: 'Copy Result' })}</button>
		</div>
	);
};
