// goal: JSON Formatter tool panel UI with i18n support

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

const logger = createLogger('JSONFormatter', 'HALO');

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '10px',
	},
	textarea: {
		width: '100%',
		minHeight: '160px',
		padding: '14px',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		background: 'var(--halo-bg-secondary, #1e1e1e)',
		color: 'var(--halo-text, #e0e0e0)',
		fontSize: '12px',
		fontFamily: 'Consolas, Monaco, "Fira Code", monospace',
		resize: 'vertical',
		lineHeight: 1.6,
		outline: 'none',
		transition: 'border-color 0.2s, box-shadow 0.2s',
	},
	errorArea: {
		borderColor: '#ef4444',
		boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.15)',
	},
	actionRow: {
		display: 'flex',
		gap: '8px',
		flexWrap: 'wrap',
	},
	btn: {
		padding: '10px 14px',
		background: 'var(--halo-bg-tertiary, #333)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '10px',
		color: 'var(--halo-text-secondary, #ddd)',
		fontSize: '11px',
		fontWeight: 500,
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},
	primaryBtn: {
		background: 'linear-gradient(135deg, var(--halo-accent, #7c3aed), #4a9eff)',
		border: 'none',
		color: '#fff',
		fontWeight: 600,
	},
	optionsRow: {
		display: 'flex',
		gap: '14px',
		alignItems: 'center',
		fontSize: '12px',
		color: 'var(--halo-text-secondary, #888)',
	},
	select: {
		padding: '6px 10px',
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '6px',
		color: 'var(--halo-text, #ddd)',
		fontSize: '11px',
		outline: 'none',
	},
	checkbox: {
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
		cursor: 'pointer',
	},
	statusBar: {
		display: 'flex',
		justifyContent: 'space-between',
		fontSize: '10px',
		color: 'var(--halo-text-muted, #666)',
		padding: '6px 2px',
	},
	error: {
		color: '#ef4444',
		fontSize: '11px',
		padding: '10px 12px',
		background: 'var(--halo-bg-secondary, #1f1f1f)',
		borderRadius: '8px',
		borderLeft: '3px solid #ef4444',
	},
	toast: {
		position: 'fixed',
		bottom: '60px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '10px 20px',
		background: 'var(--halo-accent, #7c3aed)',
		borderRadius: '24px',
		fontSize: '12px',
		fontWeight: 500,
		color: '#fff',
		zIndex: 1000,
		boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
		animation: 'fadeInUp 0.3s ease-out',
	},
};

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
