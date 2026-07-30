// goal: Gzip panel UI - compress/decompress

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { compress, decompress, getCompressionRatio } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const GzipPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useToolState<'compress' | 'decompress'>('gzip-mode', 'compress');
	const [input, setInput] = useToolState<string>('gzip-input', '');
	const [output, setOutput] = useToolState<string>('gzip-output', '');

	const [stats, setStats] = useState({ original: 0, result: 0, ratio: 0 });
	const [error, setError] = useState('');

	// Process
	const handleProcess = useCallback(async () => {
		setError('');
		try {
			if (mode === 'compress') {
				const result = await compress(input);
				setOutput(result);
				setStats({
					original: new TextEncoder().encode(input).length,
					result: result.length,
					ratio: getCompressionRatio(new TextEncoder().encode(input).length, atob(result).length),
				});
			} else {
				const result = await decompress(input);
				setOutput(result);
				setStats({
					original: input.length,
					result: new TextEncoder().encode(result).length,
					ratio: 0,
				});
			}
		} catch (_e) {
			setError(t('gzip.error'));
		}
	}, [mode, input, t, setOutput]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			{/* Mode tabs */}
			<div style={styles.tabs}>
				{(['compress', 'decompress'] as const).map((m) => (
					<button type="button" key={m} style={{ ...styles.tab, background: mode === m ? 'var(--halo-accent)' : 'var(--halo-bg-tertiary)', color: mode === m ? '#fff' : 'var(--halo-text)' }} onClick={() => setMode(m)}>
						{m === 'compress' ? '🗜️' : '📦'} {t(`gzip.${m}`)}
					</button>
				))}
			</div>

			{/* Input */}
			<div>
				<div style={styles.label}>{t('gzip.input')}</div>
				<textarea style={styles.textarea} value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === 'compress' ? t('gzip.inputText') : t('gzip.inputBase64')} />
			</div>

			{/* Process button */}
			<button type="button" style={styles.btn} onClick={handleProcess}>
				{mode === 'compress' ? '🗜️' : '📦'} {t(`gzip.${mode}`)}
			</button>

			{/* Error */}
			{error && <div style={{ color: '#ef4444', fontSize: '12px' }}>{error}</div>}

			{/* Output */}
			{output && (
				<div>
					<div style={styles.label}>{t('gzip.output')}</div>
					<textarea style={styles.textarea} value={output} readOnly onClick={handleCopy} />
					{mode === 'compress' && (
						<div style={styles.stats}>
							<span>{stats.original} B → {stats.result} chars</span>
							<span>{stats.ratio}% {t('gzip.saved')}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
