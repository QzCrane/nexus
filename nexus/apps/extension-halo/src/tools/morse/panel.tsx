// goal: Morse Code panel UI - encode/decode/play

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { encode, decode, playMorse } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const MorsePanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useToolState<'encode' | 'decode'>('morse-mode' as any, 'encode');
	const [input, setInput] = useToolState<string>('morse-input' as any, '');


	const output = useMemo(() => {
		if (!input) return '';
		return mode === 'encode' ? encode(input) : decode(input);
	}, [mode, input]);

	// Play sound
	const handlePlay = useCallback(() => {
		const morse = mode === 'encode' ? output : input;
		if (morse) playMorse(morse);
	}, [mode, input, output]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			{/* Mode tabs */}
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, background: mode === 'encode' ? 'var(--halo-accent)' : 'var(--halo-bg-tertiary)', color: mode === 'encode' ? '#fff' : 'var(--halo-text)' }} onClick={() => setMode('encode')}>
					📝 {t('morse.encode')}
				</button>
				<button style={{ ...styles.tab, background: mode === 'decode' ? 'var(--halo-accent)' : 'var(--halo-bg-tertiary)', color: mode === 'decode' ? '#fff' : 'var(--halo-text)' }} onClick={() => setMode('decode')}>
					🔤 {t('morse.decode')}
				</button>
			</div>

			{/* Input */}
			<div>
				<div style={styles.label}>{t('morse.input')}</div>
				<textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === 'encode' ? 'Hello World' : '.... . .-.. .-.. ---'} />
			</div>

			{/* Output */}
			<div>
				<div style={styles.label}>{t('morse.output')}</div>
				<textarea style={styles.textarea} value={output} readOnly />
			</div>

			{/* Actions */}
			<div style={styles.row}>
				<button style={styles.btn} onClick={handleCopy}>📋 {t('morse.copy')}</button>
				<button style={styles.btnSecondary} onClick={handlePlay}>🔊</button>
			</div>
		</div>
	);
};
