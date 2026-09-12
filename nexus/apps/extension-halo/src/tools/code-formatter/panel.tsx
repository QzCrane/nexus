// goal: Code Formatter panel UI - format and minify multiple languages

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { CodeLanguage } from './types';
import { CODE_FORMATTER_OPERATION_CONTRACT, codeIndentCodec, codeLanguageCodec, formatCode, minifyCode } from './core';
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
	const [language, setLanguage, , languageRecovery] = useToolState<CodeLanguage>('code-formatter-lang', 'json', { codec: codeLanguageCodec });
	const [code, setCode] = useToolState<string>('code-formatter-code', '');
	const [indentSize, setIndentSize, , indentRecovery] = useToolState<number>('code-formatter-indent', 2, { codec: codeIndentCodec });
	const [error, setError] = useState('');
	const { phase, run } = useOwnedAsyncTask();
	const operationContract = CODE_FORMATTER_OPERATION_CONTRACT[language];


	// Format
	const handleFormat = useCallback(() => {
		setError('');
		void run(() => formatCode(code, { language, indentSize, useTabs: false })).then((outcome) => {
			if (outcome.kind === 'succeeded') setCode(outcome.value);
			else if (outcome.kind === 'failed') setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
			else if (outcome.reason === 'deadline') setError('Formatting exceeded the execution deadline.');
		});
	}, [code, language, indentSize, run, setCode]);

	// Minify
	const handleMinify = useCallback(() => {
		setError('');
		void run(() => minifyCode(code, language)).then((outcome) => {
			if (outcome.kind === 'succeeded') setCode(outcome.value);
			else if (outcome.kind === 'failed') setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
			else if (outcome.reason === 'deadline') setError('Minification exceeded the execution deadline.');
		});
	}, [code, language, run, setCode]);

	// Copy
	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(code);
	}, [code]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={languageRecovery} emptyValue="json" exportName="halo-code-formatter-language-damaged.json" />
			<StorageRecoveryActions recovery={indentRecovery} emptyValue={2} exportName="halo-code-formatter-indent-damaged.json" />
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
			<div style={styles.boundary}>{t(operationContract.descriptionKey)}</div>

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
				<button type="button" style={styles.btn} onClick={handleFormat} disabled={phase === 'running'}>✨ {t('codeFormatter.format')}</button>
				<button type="button" style={styles.btnSecondary} onClick={handleMinify} disabled={phase === 'running'}>📦 {t('codeFormatter.minify')}</button>
				{code && <button type="button" style={styles.btnSecondary} onClick={handleCopy}>📋 {t('common.copy')}</button>}
			</div>
		</div>
	);
};
