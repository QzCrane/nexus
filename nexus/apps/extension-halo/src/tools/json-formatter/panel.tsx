// goal: JSON Formatter tool panel UI with i18n support
// eff: Styles extracted to reduce file size

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { FormatOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import {
	formatJSON,
	minifyJSON,
	validateJSON,
	copyToClipboard,
	saveOptions,
	loadOptions,
} from './core';
import { styles } from './panel.styles';

const logger = createLogger('JSONFormatter', 'HALO');

export const JSONFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [options, setOptions] = useState<FormatOptions>(DEFAULT_OPTIONS);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		loadOptions().then(setOptions);
	}, []);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 1500);
	}, []);

	const handleFormat = useCallback(() => {
		const result = formatJSON(input, options);
		if (result.success) {
			setInput(result.output);
			setError(null);
			showToast(t('jsonPanel.formatted'));
			logger.info('JSON formatted');
		} else {
			setError(result.error || t('jsonPanel.invalidJson'));
		}
	}, [input, options, showToast, t]);

	const handleMinify = useCallback(() => {
		const result = minifyJSON(input);
		if (result.success) {
			setInput(result.output);
			setError(null);
			showToast(t('jsonPanel.minified'));
			logger.info('JSON minified');
		} else {
			setError(result.error || t('jsonPanel.invalidJson'));
		}
	}, [input, showToast, t]);

	const handleCopy = useCallback(async () => {
		const ok = await copyToClipboard(input);
		showToast(ok ? t('jsonPanel.copied') : 'Copy failed');
	}, [input, showToast, t]);

	const handleClear = useCallback(() => {
		setInput('');
		setError(null);
	}, []);

	const handlePaste = useCallback(async () => {
		try {
			const text = await navigator.clipboard.readText();
			setInput(text);
			setError(null);
		} catch {
			showToast('Paste failed');
		}
	}, [showToast]);

	const handleIndentChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
		const indent = parseInt(e.target.value, 10) as 2 | 4;
		const newOptions = { ...options, indent };
		setOptions(newOptions);
		await saveOptions(newOptions);
	}, [options]);

	const handleSortChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const newOptions = { ...options, sortKeys: e.target.checked };
		setOptions(newOptions);
		await saveOptions(newOptions);
	}, [options]);

	const validation = validateJSON(input);
	const charCount = input.length;
	const lineCount = input ? input.split('\n').length : 0;

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.optionsRow}>
					<span>Indent:</span>
					<select
						value={options.indent}
						onChange={handleIndentChange}
						style={styles.select}
					>
						<option value={2}>2 spaces</option>
						<option value={4}>4 spaces</option>
					</select>
					<label style={styles.checkbox}>
						<input
							type="checkbox"
							checked={options.sortKeys}
							onChange={handleSortChange}
						/>
						{t('jsonPanel.sortKeys')}
					</label>
				</div>
			</Card>

			<textarea
				style={{ ...styles.textarea, ...(error ? styles.errorArea : {}) }}
				placeholder={t('jsonPanel.placeholder')}
				value={input}
				onChange={(e) => { setInput(e.target.value); setError(null); }}
			/>

			{error && <div style={styles.error}>⚠️ {error}</div>}

			<div style={styles.actionRow}>
				<button
					style={{ ...styles.btn, ...styles.primaryBtn }}
					onClick={handleFormat}
					disabled={!input.trim()}
				>
					✨ {t('jsonPanel.format')}
				</button>
				<button style={styles.btn} onClick={handleMinify} disabled={!input.trim()}>
					📦 {t('jsonPanel.minify')}
				</button>
				<button style={styles.btn} onClick={handleCopy} disabled={!input.trim()}>
					📋 {t('jsonPanel.copy')}
				</button>
				<button style={styles.btn} onClick={handlePaste}>
					📥 Paste
				</button>
				<button style={styles.btn} onClick={handleClear} disabled={!input}>
					🗑️ {t('jsonPanel.clear')}
				</button>
			</div>

			<div style={styles.statusBar}>
				<span>{lineCount} lines · {charCount} chars</span>
				<span style={{ color: validation.valid ? '#22c55e' : '#ef4444' }}>
					{validation.valid ? '✓ Valid' : `✗ ${t('jsonPanel.invalidJson')}`}
					{validation.size && ` · ${validation.size} bytes`}
				</span>
			</div>

			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
