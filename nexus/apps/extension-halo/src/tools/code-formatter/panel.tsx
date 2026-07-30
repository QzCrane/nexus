// goal: Code Formatter panel UI - format and minify multiple languages

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { CodeLanguage } from './types';
import { formatCode, minifyCode } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const LANGUAGES: { id: CodeLanguage; label: string }[] = [
	{ id: 'json', label: 'JSON' },
	{ id: 'html', label: 'HTML' },
	{ id: 'css', label: 'CSS' },
	{ id: 'js', label: 'JavaScript' },
	{ id: 'sql', label: 'SQL' },
	{ id: 'xml', label: 'XML' },
];

export const CodeFormatterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [language, setLanguage] = useToolState<CodeLanguage>('code-formatter-lang', 'json');
	const [code, setCode] = useToolState<string>('code-formatter-code', '');
	const [indentSize, setIndentSize] = useToolState<number>('code-formatter-indent', 2);
	const [error, setError] = useState('');


	// Format
	const handleFormat = useCallback(() => {
		setError('');
		try {
			const formatted = formatCode(code, { language, indentSize, useTabs: false });
			setCode(formatted);
		} catch (e) {
			setError((e as Error).message);
		}
	}, [code, language, indentSize, setCode]);

	// Minify
	const handleMinify = useCallback(() => {
		setError('');
		try {
			const minified = minifyCode(code, language);
			setCode(minified);
		} catch (e) {
			setError((e as Error).message);
		}
	}, [code, language, setCode]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(code);
	}, [code]);

	return (
		<div style={styles.wrapper}>
			{/* Language Tabs */}
			<div style={styles.langTabs}>
				{LANGUAGES.map((lang) => (
					<button type="button"
						key={lang.id}
						style={{ ...styles.langTab, ...(language === lang.id ? styles.active : styles.inactive) }}
						onClick={() => setLanguage(lang.id)}
					>
						{lang.label}
					</button>
				))}
			</div>

			{/* Code Input */}
			<textarea
				style={styles.textarea}
				value={code}
				onChange={(e) => setCode(e.target.value)}
				placeholder={t('codeFormatter.placeholder')}
			/>

			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.config}>
					<span style={styles.label}>{t('codeFormatter.indentSize')}</span>
					<input
						type="number"
						style={styles.input}
						value={indentSize}
						onChange={(e) => setIndentSize(Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 2)))}
						min={1}
						max={8}
					/>
				</div>
			</Card>

			{/* Error */}
			{error && <div style={styles.error}>⚠️ {error}</div>}

			{/* Actions */}
			<div style={styles.row}>
				<button type="button" style={styles.btn} onClick={handleFormat}>✨ {t('codeFormatter.format')}</button>
				<button type="button" style={styles.btnSecondary} onClick={handleMinify}>📦 {t('codeFormatter.minify')}</button>
				{code && <button type="button" style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>
		</div>
	);
};
