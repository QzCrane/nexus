// goal: Gzip panel UI - compress/decompress

import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { compress, decompress, getCompressionRatio } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

type GzipMode = 'compress' | 'decompress';
const gzipModeCodec: ToolStateCodec<GzipMode> = {
	decode: (value) => value === 'compress' || value === 'decompress' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Gzip mode is invalid.' },
	encode: (value) => value,
};


export const GzipPanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode, , modeRecovery] = useToolState<GzipMode>('gzip-mode', 'compress', { codec: gzipModeCodec });
	const [input, setInput] = useToolState<string>('gzip-input', '');
	const [output, setOutput] = useToolState<string>('gzip-output', '');

	const [stats, setStats] = useState({ original: 0, result: 0, ratio: 0 });
	const [error, setError] = useState('');
	const task = useOwnedAsyncTask();

	// Process
	const handleProcess = useCallback(async () => {
		setError('');
		const outcome = await task.run(async () => {
			if (mode === 'compress') {
				const result = await compress(input);
				return { output: result, stats: {
					original: new TextEncoder().encode(input).length,
					result: result.length,
					ratio: getCompressionRatio(new TextEncoder().encode(input).length, atob(result).length),
				} };
			} else {
				const result = await decompress(input);
				return { output: result, stats: {
					original: input.length,
					result: new TextEncoder().encode(result).length,
					ratio: 0,
				} };
			}
		});
		if (outcome.kind === 'succeeded') { setOutput(outcome.value.output); setStats(outcome.value.stats); }
		else if (outcome.kind === 'failed') setError(t('gzip.error'));
	}, [mode, input, t, setOutput, task.run]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="compress" exportName="halo-gzip-mode-damaged.json" />
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
			<button type="button" style={styles.btn} onClick={task.phase === 'running' ? task.cancel : handleProcess}>
				{task.phase === 'running' ? '✕ Cancel' : `${mode === 'compress' ? '🗜️' : '📦'} ${t(`gzip.${mode}`)}`}
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
