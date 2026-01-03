// goal: Punycode panel UI

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { encode, decode } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const PunycodePanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useToolState<string>('punycode-input' as any, '');
	const [output, setOutput] = useToolState<string>('punycode-output' as any, '');


	const handleEncode = useCallback(() => {
		// Support multiple lines or space separated domains? let's simple one for now or line by line
		const lines = input.split('\n');
		const result = lines.map(line => line.trim() ? encode(line.trim()) : '').join('\n');
		setOutput(result);
	}, [input]);

    const handleDecode = useCallback(() => {
        const lines = input.split('\n');
        const result = lines.map(line => line.trim() ? decode(line.trim()) : '').join('\n');
        setOutput(result);
    }, [input]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<div>
				<div style={styles.label}>{t('punycode.input', { defaultValue: 'Domain (Unicode / Punycode)' })}</div>
				<textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder={t('punycode.placeholder', { defaultValue: 'example: 例子.com or xn--fsq.com' })} 
                />
			</div>

			<div style={styles.row}>
				<button style={styles.btn} onClick={handleEncode}>👇 {t('punycode.encode', { defaultValue: 'Encode (to ASCII)' })}</button>
				<button style={styles.btn} onClick={handleDecode}>👆 {t('punycode.decode', { defaultValue: 'Decode (to Unicode)' })}</button>
			</div>

			{output && (
				<div>
					<div style={styles.label}>{t('punycode.result', { defaultValue: 'Result' })}</div>
					<textarea style={styles.textarea} value={output} readOnly />
                    <button style={{...styles.btn, marginTop: '8px'}} onClick={handleCopy}>📋 {t('punycode.copy', { defaultValue: 'Copy' })}</button>
				</div>
			)}
		</div>
	);
};
